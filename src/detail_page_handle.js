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
*  allPlaces: {[index: string]: any},
*  session: Apify.Session,
*  scrapingOptions: ScrapingOptions,
*  errorSnapshotter: ErrorSnapshotter,
*  stats: Stats,
* }} options
*/
module.exports.handlePlaceDetail = async (options) => {
    const {
        page, request, searchString, allPlaces, session, scrapingOptions, errorSnapshotter, stats,
    } = options;
    const {
        includeHistogram, includeOpeningHours, includePeopleAlsoSearch,
        maxReviews, maxImages, additionalInfo, geo, cachePlaces, reviewsSort, reviewsTranslation,
    } = scrapingOptions;
    // Extract basic information
    await waitForGoogleMapLoader(page);

    try {
        await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
    } catch (e) {
        session.markBad();
        throw 'The page didn\'t load fast enough, this will be retried';
    }

    // Add info from listing page
    const { rank, searchPageUrl, addressParsed, isAdvertisement } = /** @type {PlaceUserData} */ (request.userData);

    // Adding addressParsed there so it is nicely together in JSON
    const pageData = await extractPageData({ page, addressParsed });

    // Extract gps from URL
    // We need to URL will be change, it happened asynchronously
    await page.waitForFunction(() => window.location.href.includes('/place/'));
    const url = page.url();

    const coordinatesMatch = url.match(/!3d([0-9\-.]+)!4d([0-9\-.]+)/);
    const latMatch = coordinatesMatch ? coordinatesMatch[1] : null;
    const lngMatch = coordinatesMatch ? coordinatesMatch[2] : null;

    const coordinates = latMatch && lngMatch ? { lat: parseFloat(latMatch), lng: parseFloat(lngMatch) } : null;

    // check if place is inside of polygon, if not return null, geo non-null only for country/state/city/postal
    if (geo && coordinates && !checkInPolygon(geo, coordinates)) {
        // cache place location to keyVal store
        if (cachePlaces) {
            allPlaces[request.uniqueKey] = coordinates;
        }
        log.warning(`[PLACE]: Place is outside of required location (polygon), skipping... url --- ${url}`);
        stats.outOfPolygon();
        stats.addOutOfPolygonPlace({ url, searchPageUrl, coordinates });
        return;
    }

    const detail = {
        ...pageData,
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
        ...await errorSnapshotter.tryWithSnapshot(
            page,
            async () => extractReviews({ page, totalScore: pageData.totalScore, maxReviews, reviewsSort, reviewsTranslation }),
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
