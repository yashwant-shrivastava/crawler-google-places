const Apify = require('apify');
const querystring = require('querystring');

const { sleep, log } = Apify.utils;
const { DEFAULT_TIMEOUT, LISTING_PAGINATION_KEY, PLACE_TITLE_SEL } = require('./consts');
const { waitForGoogleMapLoader, parseSearchPlacesResponseBody } = require('./utils');

/**
 * This handler waiting for response from xhr and enqueue places from the search response boddy.
 * @param requestQueue
 * @param searchString
 * @param maxPlacesPerCrawl
 * @return {Function}
 */
const enqueuePlacesFromResponse = (requestQueue, searchString, maxPlacesPerCrawl, exportPlaceUrls, geo) => {
    return async (response) => {
        const url = response.url();
        if (url.startsWith('https://www.google.com/search')) {
            // Parse page number from request url
            const queryParams = querystring.parse(url.split('?')[1]);
            const pageNumber = parseInt(queryParams.ech);
            // Parse place ids from response body
            const responseBody = await response.buffer();
            const places = parseSearchPlacesResponseBody(responseBody);
            const enqueuePromises = [];
            places.forEach((place, index) => {
                const rank = ((pageNumber - 1) * 20) + (index + 1);
                if (!maxPlacesPerCrawl || rank <= maxPlacesPerCrawl) {
                    let promise;
                    if (exportPlaceUrls)
                        promise = Apify.pushData({
                            url: `https://www.google.com/maps/search/?api=1&query=${searchString}&query_place_id=${place.placeId}`
                        })
                    else
                        promise = requestQueue.addRequest({
                                url: `https://www.google.com/maps/search/?api=1&query=${searchString}&query_place_id=${place.placeId}`,
                                uniqueKey: place.placeId,
                                userData: { label: 'detail', searchString, rank, geo },
                            },
                            { forefront: true });
                    enqueuePromises.push(promise);
                }
            });
            await Promise.all(enqueuePromises);
        }
    };
};

/**
 * Method adds places from listing to queue
 * @param page
 * @param searchString
 * @param requestQueue
 * @param maxCrawledPlaces
 */
const enqueueAllPlaceDetails = async (page, searchString, requestQueue, maxCrawledPlaces, request, exportPlaceUrls, geo) => {
    page.on('response', enqueuePlacesFromResponse(requestQueue, searchString, maxCrawledPlaces, exportPlaceUrls, geo));
    // Save state of listing pagination
    // NOTE: If pageFunction failed crawler skipped already scraped pagination
    const listingStateKey = `${LISTING_PAGINATION_KEY}-${request.id}`;
    const listingPagination = await Apify.getValue(listingStateKey) || {};

    await page.type('#searchboxinput', searchString);
    await sleep(5000);
    await page.click('#searchbox-searchbutton');
    await sleep(5000);
    await waitForGoogleMapLoader(page);
    try {
        await page.waitForSelector(PLACE_TITLE_SEL);
        // It there is place detail, it means there is just one detail and it was redirected here.
        // We do not need enqueue other places.
        log.debug(`Search string ${searchString} has just one place to scraper.`);
        return;
    } catch (e) {
        // It can happen if there is list of details.
    }

    // In case there is a list of details, it goes through details, limits by maxPlacesPerCrawl
    const nextButtonSelector = '[jsaction="pane.paginationSection.nextPage"]';
    while (true) {
        await page.waitForSelector(nextButtonSelector, { timeout: DEFAULT_TIMEOUT });
        const paginationText = await page.$eval('.n7lv7yjyC35__root', (el) => el.innerText);
        const [fromString, toString] = paginationText.match(/\d+/g);
        const from = parseInt(fromString);
        const to = parseInt(toString);
        log.debug(`Added links from pagination ${from} - ${to}`);
        listingPagination.from = from;
        listingPagination.to = to;
        await Apify.setValue(listingStateKey, listingPagination);
        await page.waitForSelector(nextButtonSelector, { timeout: DEFAULT_TIMEOUT });
        const isNextPaginationDisabled = await page.evaluate((nextButtonSelector) => {
            return !!$(nextButtonSelector).attr('disabled');
        }, nextButtonSelector);
        const noResultsEl = await page.$('.section-no-result-title');
        if (isNextPaginationDisabled || noResultsEl || (maxCrawledPlaces && maxCrawledPlaces <= to)) {
            break;
        } else {
            // NOTE: puppeteer API click() didn't work :|
            await page.evaluate((sel) => $(sel).click(), nextButtonSelector);
            await waitForGoogleMapLoader(page);
        }
    }

    listingPagination.isFinish = true;
    page.removeListener('request', enqueuePlacesFromResponse);
    await Apify.setValue(listingStateKey, listingPagination);
};

module.exports = { enqueueAllPlaceDetails };
