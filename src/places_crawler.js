/* eslint-env jquery */
const Apify = require('apify');
const Globalize = require('globalize');

const DEFAULT_CRAWLER_LOCALIZATION = ['en', 'cs'];

Globalize.load(require('cldr-data').entireSupplemental());
Globalize.load(require('cldr-data').entireMainFor(...DEFAULT_CRAWLER_LOCALIZATION));

const { sleep, log } = Apify.utils;
const { injectJQuery, blockRequests } = Apify.utils.puppeteer;
const infiniteScroll = require('./infinite_scroll');
const { MAX_PAGE_RETRIES, DEFAULT_TIMEOUT, PLACE_TITLE_SEL } = require('./consts');
const { enqueueAllPlaceDetails } = require('./enqueue_places_crawler');
const {
    saveHTML, saveScreenshot, waitForGoogleMapLoader,
    parseReviewFromResponseBody, scrollTo,
} = require('./utils');
const { checkInPolygon } = require('./polygon');

const reviewSortOptions = {
    mostRelevant: 0,
    newest: 1,
    highestRanking: 2,
    lowestRanking: 3,
};

/**
 * This is the worst part - parsing data from place detail
 * @param page
 */
const extractPlaceDetail = async (options) => {
    const {
        page, request, searchString, includeHistogram, includeOpeningHours,
        includePeopleAlsoSearch, maxReviews, maxImages, additionalInfo, geo, cachePlaces, allPlaces, reviewsSort,
    } = options;
    // Extract basic information
    await waitForGoogleMapLoader(page);
    await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
    const detail = await page.evaluate((placeTitleSel) => {
        const address = $('[data-section-id="ad"] .section-info-line').text().trim();
        const addressAlt = $("button[data-tooltip*='address']").text().trim();
        const addressAlt2 = $("button[data-item-id*='address']").text().trim();
        const secondaryAddressLine = $('[data-section-id="ad"] .section-info-secondary-text').text().replace('Located in:', '').trim();
        const secondaryAddressLineAlt = $("button[data-tooltip*='locatedin']").text().replace('Located in:', '').trim();
        const secondaryAddressLineAlt2 = $("button[data-item-id*='locatedin']").text().replace('Located in:', '').trim();
        const phone = $('[data-section-id="pn0"].section-info-speak-numeral').length
            ? $('[data-section-id="pn0"].section-info-speak-numeral').attr('data-href').replace('tel:', '')
            : $("button[data-tooltip*='phone']").text().trim();
        const phoneAlt = $('button[data-item-id*=phone]').text().trim();
        let temporarilyClosed = false;
        let permanentlyClosed = false;
        const altOpeningHoursText = $('[class*="section-info-hour-text"] [class*="section-info-text"]').text().trim();
        if (altOpeningHoursText === 'Temporarily closed') temporarilyClosed = true;
        else if (altOpeningHoursText === 'Permanently closed') permanentlyClosed = true;

        return {
            title: $(placeTitleSel).text().trim(),
            totalScore: $('span.section-star-display').eq(0).text().trim(),
            categoryName: $('[jsaction="pane.rating.category"]').text().trim(),
            address: address || addressAlt || addressAlt2 || null,
            locatedIn: secondaryAddressLine || secondaryAddressLineAlt || secondaryAddressLineAlt2 || null,
            plusCode: $('[data-section-id="ol"] .widget-pane-link').text().trim()
                || $("button[data-tooltip*='plus code']").text().trim()
                || $("button[data-item-id*='oloc']").text().trim() || null,
            website: $('[data-section-id="ap"]').length
                ? $('[data-section-id="ap"]').eq('0').text().trim()
                : $("button[data-tooltip*='website']").text().trim()
                || $("button[data-item-id*='authority']").text().trim() || null,
            phone: phone || phoneAlt || null,
            temporarilyClosed,
            permanentlyClosed,
        };
    }, PLACE_TITLE_SEL);

    // Add info from listing page
    const { userData } = request;
    detail.shownAsAd = userData.shownAsAd;
    detail.rank = userData.rank;
    detail.placeId = request.uniqueKey;

    // Extract gps from URL
    // We need to URL will be change, it happened asynchronously
    await page.waitForFunction(() => window.location.href.includes('/place/'));
    const url = page.url();
    detail.url = url;
    const [_, latMatch, lngMatch] = url.match(/!3d(.*)!4d(.*)/);
    if (latMatch && lngMatch) {
        detail.location = { lat: parseFloat(latMatch), lng: parseFloat(lngMatch.replace('?hl=en')) };
    }

    // check if place is inside of polygon, if not return null
    if (geo && detail.location && !checkInPolygon(geo, detail.location)) {
        // cache place location to keyVal store
        if (cachePlaces) allPlaces[detail.placeId] = detail.location;
        return null;
    }

    // Include search string
    detail.searchString = searchString;

    // Extract histogram for popular times
    if (includeHistogram) {
        // Include live popular times value
        const popularTimesLiveRawValue = await page.evaluate(() => {
            return $('.section-popular-times-live-value').attr('aria-label');
        });
        const popularTimesLiveRawText = await page.evaluate(() => $('.section-popular-times-live-description').text().trim());
        detail.popularTimesLiveText = popularTimesLiveRawText;
        const popularTimesLivePercentMatch = popularTimesLiveRawValue ? popularTimesLiveRawValue.match(/(\d+)\s?%/) : null;
        detail.popularTimesLivePercent = popularTimesLivePercentMatch ? Number(popularTimesLivePercentMatch[1]) : null;

        const histogramSel = '.section-popular-times';
        if (await page.$(histogramSel)) {
            detail.popularTimesHistogram = await page.evaluate(() => {
                const graphs = {};
                const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
                // Extract all days graphs
                $('.section-popular-times-graph').each(function (i) {
                    const day = days[i];
                    graphs[day] = [];
                    let graphStartFromHour;
                    // Finds where x axis starts
                    $(this).find('.section-popular-times-label').each(function (labelIndex) {
                        if (graphStartFromHour) return;
                        const hourText = $(this).text().trim();
                        graphStartFromHour = hourText.includes('p')
                            ? 12 + (parseInt(hourText, 10) - labelIndex)
                            : parseInt(hourText, 10) - labelIndex;
                    });
                    // Finds values from y axis
                    $(this).find('.section-popular-times-bar').each(function (barIndex) {
                        const occupancyMatch = $(this).attr('aria-label').match(/\d+(\s+)?%/);
                        if (occupancyMatch && occupancyMatch.length) {
                            const maybeHour = graphStartFromHour + barIndex;
                            graphs[day].push({
                                hour: maybeHour > 24 ? maybeHour - 24 : maybeHour,
                                occupancyPercent: parseInt(occupancyMatch[0], 10),
                            });
                        }
                    });
                });
                return graphs;
            });
        }
    }

    // Extract opening hours
    if (includeOpeningHours) {
        const openingHoursSel = '.section-open-hours-container.section-open-hours-container-hoverable';
        const openingHoursSelAlt = '.section-open-hours-container.section-open-hours';
        const openingHoursSelAlt2 = '.section-open-hours-container';
        const openingHoursEl = (await page.$(openingHoursSel)) || (await page.$(openingHoursSelAlt)) || (await page.$(openingHoursSelAlt2));
        if (openingHoursEl) {
            const openingHoursText = await page.evaluate((openingHoursEl) => {
                return openingHoursEl.getAttribute('aria-label');
            }, openingHoursEl);
            const openingHours = openingHoursText.split(openingHoursText.includes(';') ? ';' : ',');
            if (openingHours.length) {
                detail.openingHours = openingHours.map((line) => {
                    const regexpResult = line.trim().match(/(\S+)\s(.*)/);
                    if (regexpResult) {
                        let [match, day, hours] = regexpResult;
                        hours = hours.split('.')[0];
                        return { day, hours };
                    }
                    log.debug(`Not able to parse opening hours: ${line}`);
                });
            }
        }
    }

    // Extract "People also search"
    const peopleSearchContainer = await page.$('.section-carousel-scroll-container');
    if (peopleSearchContainer && includePeopleAlsoSearch) {
        detail.peopleAlsoSearch = [];
        const cardSel = 'button[class$="card"]';
        const cards = await peopleSearchContainer.$$(cardSel);
        for (let i = 0; i < cards.length; i++) {
            const searchResult = await page.evaluate((index, sel) => {
                const card = $(sel).eq(index);
                return {
                    title: card.find('div[class$="title"]').text().trim(),
                    totalScore: card.find('span[class$="rating"]').text().trim(),
                };
            }, i, cardSel);
            // For some reason, puppeteer click doesn't work here
            await Promise.all([
                page.evaluate((button, index) => {
                    $(button).eq(index).click();
                }, cardSel, i),
                page.waitForNavigation({ waitUntil: ['domcontentloaded', 'networkidle2'] }),
            ]);
            searchResult.url = await page.url();
            detail.peopleAlsoSearch.push(searchResult);
            await Promise.all([
                page.goBack({ waitUntil: ['domcontentloaded', 'networkidle2'] }),
                waitForGoogleMapLoader(page),
            ]);
        }
    }

    // Extract additional info
    if (additionalInfo) {
        log.debug('Scraping additional info.');
        const button = await page.$('button.section-editorial');
        try {
            await button.click();
            await page.waitForSelector('.section-attribute-group', { timeout: 3000 });
            const sections = await page.evaluate(() => {
                const result = {};
                $('.section-attribute-group').each((i, section) => {
                    const key = $(section).find('.section-attribute-group-title').text().trim();
                    const values = [];
                    $(section).find('.section-attribute-group-container .section-attribute-group-item').each((i, sub) => {
                        const res = {};
                        const title = $(sub).text().trim();
                        const val = $(sub).find('.section-attribute-group-item-icon.maps-sprite-place-attributes-done').length > 0;
                        res[title] = val;
                        values.push(res);
                    });
                    result[key] = values;
                });
                return result;
            });
            detail.additionalInfo = sections;
            const backButton = await page.$('button[aria-label*=Back]');
            await backButton.click();
        } catch (e) {
            log.info(`${e}Additional info not parsed`);
        }
    }

    // Extract reviews
    const reviewsButtonSel = 'button[jsaction="pane.reviewChart.moreReviews"]';
    if (detail.totalScore) {
        const { reviewsCountText, localization } = await page.evaluate((selector) => {
            const numberReviewsText = $(selector).text().trim();
            // NOTE: Needs handle:
            // Recenze: 7
            // 1.609 reviews
            // 9 reviews
            const number = numberReviewsText.match(/[.,0-9]+/);
            return {
                reviewsCountText: number ? number[0] : null,
                localization: navigator.language.slice(0, 2),
            };
        }, reviewsButtonSel);
        let globalParser;
        try {
            globalParser = Globalize(localization);
        } catch (e) {
            throw new Error(`Can not find localization for ${localization}, try to use different proxy IP.`);
        }
        detail.totalScore = globalParser.numberParser({ round: 'floor' })(detail.totalScore);
        detail.reviewsCount = reviewsCountText ? globalParser.numberParser({ round: 'truncate' })(reviewsCountText) : null;
        // If we find consent dialog, close it!
        if (await page.$('.widget-consent-dialog')) {
            await page.click('.widget-consent-dialog .widget-consent-button-later');
        }
        // Get all reviews
        if (typeof maxReviews === 'number' && maxReviews > 0) {
            detail.reviews = [];
            await page.waitForSelector(reviewsButtonSel);
            await page.click(reviewsButtonSel);
            // Set up sort from newest
            const sortPromise1 = async () => {
                try {
                    await page.click('[class*=dropdown-icon]');
                    await sleep(1000);
                    for (let i = 0; i < reviewSortOptions[reviewsSort]; i += 1) {
                        await page.keyboard.press('ArrowDown');
                    }
                    await page.keyboard.press('Enter');
                } catch (e) {
                    log.debug('Can not sort reviews with 1 options!');
                }
            };
            const sortPromise2 = async () => {
                try {
                    await page.click('button[data-value="Sort"]');
                    for (let i = 0; i < reviewSortOptions[reviewsSort]; i += 1) {
                        await page.keyboard.press('ArrowDown');
                    }
                    await page.keyboard.press('Enter');
                } catch (e) {
                    log.debug('Can not sort with 2 options!');
                }
            };
            await sleep(5000);
            const [sort1, sort2, scroll, reviewsResponse] = await Promise.all([
                sortPromise1(),
                sortPromise2(),
                scrollTo(page, '.section-scrollbox.scrollable-y', 10000),
                page.waitForResponse((response) => response.url().includes('preview/review/listentitiesreviews')),
            ]);

            const reviewResponseBody = await reviewsResponse.buffer();
            const reviews = parseReviewFromResponseBody(reviewResponseBody);

            detail.reviews.push(...reviews);
            detail.reviews = detail.reviews.slice(0, maxReviews);
            log.info(`Exracting reviews: ${detail.reviews.length}/${maxReviews} --- ${page.url()}`);
            let reviewUrl = reviewsResponse.url();
            // Replace !3e1 in URL with !3e2, it makes list sort by newest
            reviewUrl = reviewUrl.replace(/!3e\d/, '!3e2');
            // Make sure that we star review from 0, setting !1i0
            reviewUrl = reviewUrl.replace(/!1i\d+/, '!1i0');
            const increaseLimitInUrl = (url) => {
                const numberString = reviewUrl.match(/!1i(\d+)/)[1];
                const number = parseInt(numberString, 10);
                return url.replace(/!1i\d+/, `!1i${number + 10}`);
            };

            while (detail.reviews.length < maxReviews) {
                // Request in browser context to use proxy as in brows
                const responseBody = await page.evaluate(async (url) => {
                    const response = await fetch(url);
                    return await response.text();
                }, reviewUrl);
                const reviews = parseReviewFromResponseBody(responseBody);
                if (reviews.length === 0) {
                    break;
                }
                detail.reviews.push(...reviews);
                detail.reviews = detail.reviews.slice(0, maxReviews);
                log.info(`Exracting reviews: ${detail.reviews.length}/${maxReviews} --- ${page.url()}`);
                reviewUrl = increaseLimitInUrl(reviewUrl);
            }
            log.info(`Reviews extraction finished: ${detail.reviews.length} --- ${page.url()}`);

            await page.click('button[jsaction*=back]');
        }
    }

    // Extract place images
    if (typeof maxImages === 'number' && maxImages > 0) {
        await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
        const imagesButtonSel = '.section-hero-header-image-hero-container';
        const imagesButton = await page.$(imagesButtonSel);
        if (imagesButton) {
            await sleep(2000);
            await imagesButton.click();
            let lastImage = null;
            let pageBottom = 10000;
            let imageUrls = [];

            while (true) {
                log.info(`Infinite scroll for images started, url: ${page.url()}`);
                await infiniteScroll(page, pageBottom, '.section-scrollbox.scrollable-y', 'images', 1);
                imageUrls = await page.evaluate(() => {
                    const urls = [];
                    $('.gallery-image-high-res').each(function () {
                        const urlMatch = $(this).attr('style').match(/url\("(.*)"\)/);
                        if (!urlMatch) return;
                        let imageUrl = urlMatch[1];
                        if (imageUrl[0] === '/') imageUrl = `https:${imageUrl}`;
                        urls.push(imageUrl);
                    });
                    return urls;
                });
                if (imageUrls.length >= maxImages || lastImage === imageUrls[imageUrls.length - 1]) {
                    log.info(`Infinite scroll for images finished, url: ${page.url()}`);
                    break;
                }
                log.info(`Infinite scroll continuing for images, currently ${imageUrls.length}, url: ${page.url()}`);
                lastImage = imageUrls[imageUrls.length - 1];
                pageBottom += 6000;
            }
            detail.imageUrls = imageUrls.slice(0, maxImages);
        }
    }

    return detail;
};

const setUpCrawler = (crawlerOptions, scrapingOptions, stats, allPlaces) => {
    const {
        includeHistogram, includeOpeningHours, includePeopleAlsoSearch,
        maxReviews, maxImages, exportPlaceUrls, forceEng, additionalInfo, maxCrawledPlaces,
        maxAutomaticZoomOut, cachePlaces, reviewsSort,
    } = scrapingOptions;
    const { requestQueue } = crawlerOptions;
    return new Apify.PuppeteerCrawler({
        ...crawlerOptions,
        gotoFunction: async ({ request, page }) => {
            await page._client.send('Emulation.clearDeviceMetricsOverride');
            // This blocks images so we have to skip it
            if (!maxImages) {
                await blockRequests(page, {
                    urlPatterns: ['/maps/vt/', '/earth/BulkMetadata/', 'googleusercontent.com'],
                });
            }
            if (forceEng) request.url += '&hl=en';
            await page.setViewport({ width: 800, height: 800 });
            await page.goto(request.url, { timeout: crawlerOptions.pageLoadTimeoutMs });
        },
        handlePageFunction: async ({ request, page, puppeteerPool, autoscaledPool }) => {
            const { label, searchString, geo } = request.userData;

            log.info(`Open ${request.url} with label: ${label}`);
            await injectJQuery(page);

            try {
                // Check if Google shows captcha
                if (await page.$('form#captcha-form')) {
                    console.log('******\nGoogle shows captcha. This browser will be retired.\n******');
                    throw new Error('Needs to fill captcha!');
                }
                if (label === 'startUrl') {
                    log.info(`Start enqueuing places details for search: ${searchString}`);
                    await enqueueAllPlaceDetails(page, searchString, requestQueue, maxCrawledPlaces, request,
                        exportPlaceUrls, geo, maxAutomaticZoomOut, allPlaces, cachePlaces, stats);
                    log.info('Enqueuing places finished.');
                    stats.maps();
                } else {
                    // Get data for place and save it to dataset
                    log.info(`Extracting details from place url ${page.url()}`);
                    const placeDetail = await extractPlaceDetail({
                        page,
                        request,
                        searchString,
                        includeHistogram,
                        includeOpeningHours,
                        includePeopleAlsoSearch,
                        maxReviews,
                        maxImages,
                        additionalInfo,
                        geo,
                        cachePlaces,
                        allPlaces,
                        reviewsSort,
                    });
                    if (placeDetail) {
                        await Apify.pushData(placeDetail);
                        // when using polygon search multiple start urls are used. Therefore more links are added to request queue,
                        // there is also good possibility that some of places will be out of desired polygon, so we do not check number of queued places,
                        // only number of places with correct geolocation
                        if (maxCrawledPlaces && maxCrawledPlaces !== 0) {
                            const dataset = await Apify.openDataset();
                            const { cleanItemCount } = await dataset.getInfo();
                            if (cleanItemCount >= maxCrawledPlaces) {
                                await autoscaledPool.abort();
                            }
                        }
                        stats.places();
                        log.info(`Finished place url ${placeDetail.url}`);
                    } else {
                        stats.outOfPolygon();
                        log.info(`Place outside of polygon, url: ${page.url()}`);
                    }
                }
                stats.ok();
            } catch (err) {
                // This issue can happen, mostly because proxy IP was blocked by google
                // Let's refresh IP using browser refresh.
                if (log.getLevel() === log.LEVELS.DEBUG) {
                    await saveHTML(page, `${request.id}.html`);
                    await saveScreenshot(page, `${request.id}.png`);
                }
                await puppeteerPool.retire(page.browser());
                if (request.retryCount < crawlerOptions.maxRequestRetries && log.getLevel() !== log.LEVELS.DEBUG) {
                    // This fix to not show stack trace in log for retired requests, but we should handle this on SDK
                    const info = 'Stack trace was omitted for retires requests. Set up debug mode to see it.';
                    throw `${err.message} (${info})`;
                }
                throw err;
            }
        },
        handleFailedRequestFunction: async ({ request, error }) => {
            // This function is called when crawling of a request failed too many time
            stats.failed();
            const defaultStore = await Apify.openKeyValueStore();
            await Apify.pushData({
                '#url': request.url,
                '#succeeded': false,
                '#errors': request.errorMessages,
                '#debugInfo': Apify.utils.createRequestDebugInfo(request),
                '#debugFiles': {
                    html: defaultStore.getPublicUrl(`${request.id}.html`),
                    screen: defaultStore.getPublicUrl(`${request.id}.png`),
                },
            });
            log.exception(error, `Page ${request.url} failed ${request.retryCount + 1} times! It will not be retired. Check debug fields in dataset to find the issue.`);
        },
    });
};

module.exports = { setUpCrawler };
