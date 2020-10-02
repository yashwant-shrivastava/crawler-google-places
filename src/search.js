const Apify = require('apify');

const { getGeolocation, findPointsInPolygon } = require('./polygon');

exports.prepareSearchUrls = async ({ lat, lng, zoom, country, state, city }) => {
    // Base part of the URLs to make up the startRequests
    const startUrlSearches = [];

    // save geolocation to keyval
    let geo = await Apify.getValue('GEO');
    Apify.events.on('migrating', async () => {
        await Apify.setValue('GEO', geo);
    });

    // preference for startUrlSearches is lat & lng > & state & city
    if (lat || lng) {
        if (!lat || !lng) {
            throw 'You have to defined both lat and lng!';
        }
        startUrlSearches.push(`https://www.google.com/maps/@${lat},${lng},${zoom}z/search`);
    } else if (country || state || city) {
        // Takes from KV or crate new one
        geo = geo || await getGeolocation({ country, state, city });

        let points = [];
        points = await findPointsInPolygon(geo, zoom, points);
        for (const point of points) {
            startUrlSearches.push(`https://www.google.com/maps/@${point.lat},${point.lon},${zoom}z/search`);
        }
    } else {
        startUrlSearches.push('https://www.google.com/maps/search/');
    }
    return { startUrlSearches, geo };
};
