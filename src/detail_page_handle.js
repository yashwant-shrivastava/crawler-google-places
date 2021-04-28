const Apify = require('apify'); // eslint-disable-line no-unused-vars
const Puppeteer = require('puppeteer'); // eslint-disable-line

const { ScrapingOptions, AddressParsed, PlaceUserData } = require('./typedefs'); // eslint-disable-line no-unused-vars
const ErrorSnapshotter = require('./error-snapshotter'); // eslint-disable-line no-unused-vars
const Stats = require('./stats'); // eslint-disable-line no-unused-vars

const { extractPageData, extractPopularTimes, extractOpeningHours, extractPeopleAlsoSearch,
    extractAdditionalInfo, extractReviews, extractImages } = require('./extractors');
const { DEFAULT_TIMEOUT, PLACE_TITLE_SEL } = require('./consts');
const { checkInPolygon } = require('./polygon');
const { waitForGoogleMapLoader } = require('./utils');

const { log } = Apify.utils;

/**
 * @param {{
*  page: Puppeteer.Page,
*  request: Apify.Request,
*  searchString: string,
*  session: Apify.Session,
*  scrapingOptions: ScrapingOptions,
*  errorSnapshotter: ErrorSnapshotter,
*  stats: Stats,
* }} options
*/
module.exports.handlePlaceDetail = async (options) => {
    const {
        page, request, searchString, session, scrapingOptions, errorSnapshotter, stats,
    } = options;
    const {
        includeHistogram, includeOpeningHours, includePeopleAlsoSearch,
        maxReviews, maxImages, additionalInfo, reviewsSort, reviewsTranslation,
    } = scrapingOptions;
    // Extract basic information
    await waitForGoogleMapLoader(page);

    // Some customers are passing link to the reviews subpage for some reason
    const maybeBackButton = await page.$('button[aria-label="Back"]');
    if (maybeBackButton) {
        await maybeBackButton.click();
    }

    try {
        await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
    } catch (e) {
        session.markBad();
        throw 'The page didn\'t load fast enough, this will be retried';
    }

    // Add info from listing page
    // TODO: Address should be parsed from place JSON so it works on direct places
    const { rank, searchPageUrl, addressParsed, isAdvertisement } = /** @type {PlaceUserData} */ (request.userData);

    // Adding addressParsed there so it is nicely together in JSON
    const pageData = await extractPageData({ page, addressParsed });

    // Extract gps from URL
    // We need to URL will be change, it happened asynchronously
    if (!maybeBackButton) {
        await page.waitForFunction(() => window.location.href.includes('/place/'));
    }
    const url = page.url();

    const coordinatesMatch = url.match(/!3d([0-9\-.]+)!4d([0-9\-.]+)/);
    const latMatch = coordinatesMatch ? coordinatesMatch[1] : null;
    const lngMatch = coordinatesMatch ? coordinatesMatch[2] : null;

    const coordinates = latMatch && lngMatch ? { lat: parseFloat(latMatch), lng: parseFloat(lngMatch) } : null;

    // NOTE: This is empty for certain types of direct URLs
    // Search and place IDs work fine
    const reviewsJson = await page.evaluate(() => {
        try {
            // @ts-ignore
            return JSON.parse(APP_INITIALIZATION_STATE[3][6].replace(`)]}'`, ''))[6];
        } catch (e) { }
    });
    
    let totalScore = reviewsJson && reviewsJson[4] ? reviewsJson[4][7] : null;
    let reviewsCount = reviewsJson && reviewsJson[4] ? reviewsJson[4][8] : 0;

    // We fallback to HTML (might be good to do only)
    if (!totalScore) {
        totalScore = await page.evaluate(() => Number($(('[class*="section-star-display"]'))
            .eq(0).text().trim().replace(',', '.')) || null)
    }

    if (!reviewsCount) {
        reviewsCount = await page.evaluate(() => Number($('button[jsaction="pane.reviewChart.moreReviews"]')
            .text()
            .replace(/[^0-9]+/g, '')) || 0);
    }

    // TODO: Add a backup and figure out why some direct start URLs don't load reviewsJson
    // direct place IDs are fine
    const reviewsDistributionDefault = {
        oneStar: 0,
        twoStar: 0,
        threeStar: 0,
        fourStar: 0,
        fiveStar: 0,
    };

    let reviewsDistribution = reviewsDistributionDefault;

    if (reviewsJson) {
        if (reviewsJson[52] && Array.isArray(reviewsJson[52][3])) {
            const [oneStar, twoStar, threeStar, fourStar, fiveStar ] = reviewsJson[52][3];
            reviewsDistribution = { oneStar, twoStar, threeStar, fourStar, fiveStar };
        }
    }

    const defaultReviewsJson = reviewsJson && reviewsJson[52] && reviewsJson[52][0];
    await Apify.setValue('DEFAUL-REV', defaultReviewsJson);
    
    const detail = {
        ...pageData,
        totalScore,
        isAdvertisement,
        rank,
        placeId: request.uniqueKey,
        url,
        searchPageUrl,
        searchString,
        location: coordinates, // keeping backwards compatible even though coordinates is better name
        scrapedAt: new Date().toISOString(),
        ...includeHistogram ? await extractPopularTimes({ page }) : {},
        openingHours: includeOpeningHours ? await extractOpeningHours({ page }) : undefined,
        peopleAlsoSearch: includePeopleAlsoSearch ? await extractPeopleAlsoSearch({ page }) : undefined,
        additionalInfo: additionalInfo ? await extractAdditionalInfo({ page }) : undefined,
        reviewsCount,
        reviewsDistribution,
        reviews: await errorSnapshotter.tryWithSnapshot(
            page,
            async () => extractReviews({ page, reviewsCount, maxReviews,
                reviewsSort, reviewsTranslation, defaultReviewsJson, personalDataOptions: scrapingOptions.personalDataOptions }),
            { name: 'Reviews extraction' },
        ),
        imageUrls: await errorSnapshotter.tryWithSnapshot(
            page,
            async () => extractImages({ page, maxImages }),
            { name: 'Image extraction' },
        ),
    };

    await Apify.pushData(detail);
    stats.places();
    log.info(`[PLACE]: Place scraped successfully --- ${url}`);
};
