const Apify = require('apify');
const placesCrawler = require('./places_crawler');
const resultJsonSchema = require('./result_item_schema');
const { proxyCheck } = require('./proxy_check');
const { log } = Apify.utils;

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    const { searchString, proxyConfig, lat, lng, maxCrawledPlaces, regularTestRun,
        includeReviews = true, includeImages = true, walker } = input;

    if (!searchString) throw new Error('Attribute searchString missing in input.');

    // const proxyCheckResult = await proxyCheck(proxyConfig);
    // if (!proxyCheckResult.isPass) {
    //     throw new Error(`Proxy error: ${proxyCheckResult.message}`);
    // }

    log.info('Scraping Google Places for search string:', searchString);

    const startUrls = [];
    if (lat || lng) {
        const { zoom = 10 } = input;
        if (!lat || !lng) throw new Error('You have to defined lat and lng!');
        startUrls.push(`https://www.google.com/maps/@${lat},${lng},${zoom}z/search`);
    } else if (walker) {
        const { zoom, step, bounds } = walker;
        const { northeast, southwest } = bounds;
        log.info(`Using walker mode, generating pieces of map to walk with step ${step}, zoom ${step} and bounds ${JSON.stringify(bounds)}.`);
        /**
         * The hidden feature, with walker you can search business in specific square on map.
         */
        // Generate URLs to walk
        for (let walkerLng = northeast.lng; walkerLng >= southwest.lng; walkerLng = walkerLng - step) {
            for (let walkerLat = northeast.lat; walkerLat >= southwest.lat; walkerLat = walkerLat - step) {
                startUrls.push(`https://www.google.com/maps/@${walkerLat},${walkerLng},${zoom}z/search`)
            }
        }
    } else {
        startUrls.push('https://www.google.com/maps/search/');
    }

    log.info('Start url is', startUrls);
    const requestQueue = await Apify.openRequestQueue();
    /**
     * User can use place_id:<Google place ID> as search query
     * TODO: Move place id to separate fields, once we have dependent fields. Than user can fill placeId or search query.
     */
    if (searchString.includes('place_id:')) {
        log.info(`Place ID found in search query. We will extract data from ${searchString}.`);
        const placeUrl = `https://www.google.com/maps/place/?q=${searchString.replace(/\s+/g, '')}`;
        await requestQueue.addRequest({ url: placeUrl, userData: { label: 'placeDetail' } });
    } else {
        for (const url of startUrls) {
            await requestQueue.addRequest({ url, userData: { label: 'startUrl', searchString } });
        }
    }

    const launchPuppeteerOptions = {};
    if (proxyConfig) Object.assign(launchPuppeteerOptions, proxyConfig);

    // Create and run crawler
    const crawler = placesCrawler.setUpCrawler(launchPuppeteerOptions, requestQueue,
        maxCrawledPlaces, includeReviews, includeImages, startUrls.length);
    await crawler.run();

    if (regularTestRun) {
        const { defaultDatasetId: datasetId } = Apify.getEnv();
        await Apify.call('drobnikj/check-crawler-results', {
            datasetId,
            options: {
                minOutputtedPages: 5,
                jsonSchema: resultJsonSchema,
                notifyTo: 'jakub.drobnik@apify.com',
            },
        });
    }

    log.info('Done!');
});
