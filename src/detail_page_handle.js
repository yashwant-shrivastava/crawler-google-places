const Apify = require('apify'); // eslint-disable-line no-unused-vars
const Puppeteer = require('puppeteer'); // eslint-disable-line no-unused-vars

const typedefs = require('./typedefs'); // eslint-disable-line no-unused-vars
const ErrorSnapshotter = require('./error-snapshotter'); // eslint-disable-line no-unused-vars

const { extractPageData, extractPopularTimes, extractOpeningHours, extractPeopleAlsoSearch,
    extractAdditionalInfo, extractReviews, extractImages } = require('./extractors');
const { DEFAULT_TIMEOUT, PLACE_TITLE_SEL } = require('./consts');
const { checkInPolygon } = require('./polygon');
const { waitForGoogleMapLoader } = require('./utils');

/**
 * @param {{
*  page: Puppeteer.Page,
*  request: Apify.Request,
*  searchString: string,
*  allPlaces: {[index: string]: any},
*  session: Apify.Session,
*  scrapingOptions: typedefs.ScrapingOptions,
*  errorSnapshotter: ErrorSnapshotter,
* }} options
*/
module.exports.extractPlaceDetail = async (options) => {
    const {
        page, request, searchString, allPlaces, session, scrapingOptions, errorSnapshotter,
    } = options;
    const {
        includeHistogram, includeOpeningHours, includePeopleAlsoSearch,
        maxReviews, maxImages, additionalInfo, geo, cachePlaces, reviewsSort,
    } = scrapingOptions;
    // Extract basic information
    await waitForGoogleMapLoader(page);

    try {
        await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
    } catch (e) {
        session.markBad();
        throw 'The page didn\'t load fast enough, this will be retried';
    }

    const pageData = await extractPageData({ page });

    // Extract gps from URL
    // We need to URL will be change, it happened asynchronously
    await page.waitForFunction(() => window.location.href.includes('/place/'));
    const url = page.url();

    const locationMatch = url.match(/!3d([0-9\-.]+)!4d([0-9\-.]+)/);
    const latMatch = locationMatch ? locationMatch[1] : null;
    const lngMatch = locationMatch ? locationMatch[2] : null;

    const location = latMatch && lngMatch ? { lat: parseFloat(latMatch), lng: parseFloat(lngMatch) } : null;

    // check if place is inside of polygon, if not return null, geo non-null only for country/state/city/postal
    if (geo && location && !checkInPolygon(geo, location)) {
        // cache place location to keyVal store
        if (cachePlaces) {
            allPlaces[request.uniqueKey] = location;
        }
        return null;
    }

    // Add info from listing page
    const { userData } = request;

    const detail = {
        ...pageData,
        shownAsAd: userData.shownAsAd,
        rank: userData.rank,
        placeId: request.uniqueKey,
        url,
        searchString,
        location,
        scrapedAt: new Date().toISOString(),
        ...includeHistogram ? await extractPopularTimes({ page }) : {},
        openingHours: includeOpeningHours ? await extractOpeningHours({ page }) : undefined,
        peopleAlsoSearch: includePeopleAlsoSearch ? await extractPeopleAlsoSearch({ page }) : undefined,
        additionalInfo: additionalInfo ? await extractAdditionalInfo({ page }) : undefined,
        ...await errorSnapshotter.tryWithSnapshot(
            page,
            async () => extractReviews({ page, totalScore: pageData.totalScore, maxReviews, reviewsSort }),
            { name: 'Reviews extraction', returnError: false },
        ),
        imageUrls: await errorSnapshotter.tryWithSnapshot(
            page,
            async () => extractImages({ page, maxImages }),
            { name: 'Image extraction', returnError: false },
        ),
    };

    return detail;
};
