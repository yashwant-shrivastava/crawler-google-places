const Apify = require('apify');
const placesCrawler = require('./places_crawler');
const resultJsonSchema = require('./result_item_schema');
const _ = require('lodash');
const { log } = Apify.utils;
const { getGeolocation, findPointsInPolygon } = require('./polygon');

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');

    // Small hack for backward compatibillity
    // Previously there was a checkbox includeImages and includeReviews. It had to be on.
    // maxImages and maxReviews 0 or empty scraped all
    // Right now, it works like you woudl expect, 0 or empty means no images, for all images just set 99999
    // If includeReviews/includeImages is not present, we process regularly
    if (input.includeReviews === true && !input.maxReviews) {
        input.maxReviews = 999999;
    }

    if (input.includeReviews === false) {
        input.maxReviews = 0;
    }

    if (input.includeImages === true && !input.maxImages) {
        input.maxImages = 999999;
    }

    if (input.includeImages === false) {
        input.maxImages = 0;
    }

    const {
        startUrls, searchString, searchStringsArray, proxyConfig, lat, lng, regularTestRun,
        // walker is undocumented feature added by jakubdrobnik, we need to test it and document it
        walker,
        debug, country, state, city, zoom = 10
    } = input;

    if (debug) log.setLevel(log.LEVELS.DEBUG);
    if (!searchString && !searchStringsArray && !startUrls) throw new Error('Attribute startUrls or searchString or searchStringsArray is missing in input.');
    if (proxyConfig && proxyConfig.apifyProxyGroups
        && (proxyConfig.apifyProxyGroups.includes('GOOGLESERP') || proxyConfig.apifyProxyGroups.includes('GOOGLE_SERP'))) {
        throw new Error('It is not possible to crawl google places with GOOGLE SERP proxy group. Please use a different one and rerun crawler.');
    }

    // save geolocation to keyval
    let geo = await Apify.getValue('GEO');
    Apify.events.on('migrating', async () => {
        await Apify.setValue('GEO', geo);
    });

    // Base part of the URLs to make up the startRequests
    const startUrlSearches = [];

    // preference for startUrlSearches is lat & lng > & state & city
    if (lat || lng) {
        if (!lat || !lng) throw new Error('You have to defined lat and lng!');
        startUrlSearches.push(`https://www.google.com/maps/@${lat},${lng},${zoom}z/search`);
    } else if (country || state || city) {
        geo = geo || await getGeolocation({ country, state, city });

        let points = [];
        points = await findPointsInPolygon(geo, zoom, points);
        for (const point of points) {
            startUrlSearches.push(`https://www.google.com/maps/@${point.lat},${point.lon},${zoom}z/search`);
        }
    } else {
        startUrlSearches.push('https://www.google.com/maps/search/')
    }

    // Requests that are used in the queue
    const startRequests = [];

    // Preference for startRequests is walker > startUrls > searchString || searchStringsArray
    if (walker && searchString) {
        const { zoom, step, bounds } = walker;
        const { northeast, southwest } = bounds;
        log.info(`Using walker mode, generating pieces of map to walk with step ${step}, zoom ${step} and bounds ${JSON.stringify(bounds)}.`);
        /**
         * The hidden feature, with walker you can search business in specific square on map.
         */
        // Generate URLs to walk
        for (let walkerLng = northeast.lng; walkerLng >= southwest.lng; walkerLng = walkerLng - step) {
            for (let walkerLat = northeast.lat; walkerLat >= southwest.lat; walkerLat = walkerLat - step) {
                startRequests.push({
                    url: `https://www.google.com/maps/@${walkerLat},${walkerLng},${zoom}z/search`,
                    userData: { label: 'startUrl', searchString },
                });
            }
        }
    } else if (startUrls) {
        for (const url of startUrls) {
            startRequests.push({
                ...url,
                userData: { label: 'startUrl', searchString: null }
            });
        }
    } else if (searchString || searchStringsArray) {
        if (searchStringsArray && !Array.isArray(searchStringsArray)) throw new Error('Attribute searchStringsArray has to be an array.');
        const searches = searchStringsArray || [searchString];
        for (const search of searches) {
            /**
             * User can use place_id:<Google place ID> as search query
             * TODO: Move place id to separate fields, once we have dependent fields. Than user can fill placeId or search query.
             */
            if (search.includes('place_id:')) {
                log.info(`Place ID found in search query. We will extract data from ${search}.`);
                const cleanSearch = search.replace(/\s+/g, '')
                const placeId = cleanSearch.match(/place_id\:(.*)/)[1];
                startRequests.push({
                    url: `https://www.google.com/maps/search/?api=1&query=${cleanSearch}&query_place_id=${placeId}`,
                    uniqueKey: placeId,
                    userData: { label: 'detail', searchString },
                });
            } else {
                for (const startUrlSearch of startUrlSearches) {
                    startRequests.push({
                        url: startUrlSearch,
                        uniqueKey: `${startUrlSearch}+${search}`,
                        userData: { label: 'startUrl', searchString: search, geo }
                    });
                }
            }
        }
    }

    log.info('Start urls are:');
    console.dir(startRequests.map(r => r.url));

    const requestQueue = await Apify.openRequestQueue();

    for (const request of startRequests) {
        await requestQueue.addRequest(request);
    }

    const puppeteerPoolOptions = {
        launchPuppeteerOptions: {
            headless: true,
        },
        maxOpenPagesPerInstance: 1,
    };

    let proxyConfiguration;
    const hasCustomProxies = proxyConfig.proxyUrls && proxyConfig.proxyUrls.length > 0;
    if (proxyConfig && (proxyConfig.useApifyProxy || hasCustomProxies)) {
        proxyConfiguration = await Apify.createProxyConfiguration({
            groups: proxyConfig.apifyProxyGroups,
            countryCode: proxyConfig.apifyProxyCountry,
            proxyUrls: proxyConfig.proxyUrls
        });
    }

    // Create and run crawler
    const crawler = placesCrawler.setUpCrawler(puppeteerPoolOptions, requestQueue, proxyConfiguration, input);
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
