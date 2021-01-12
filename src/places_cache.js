const Apify = require('apify');
const { utils: { log } } = Apify;
const { checkInPolygon } = require('./polygon');
const cachedPlacesName = 'Places-cached-locations';

exports.PlacesCache = class PlacesCache {
    cachePlaces;
    allPlaces = {};
    isLoaded = false;

    constructor({ cachePlaces = false, cacheKey, useCachedPlaces }) {
        this.cachePlaces = cachePlaces;
        this.cacheKey = cacheKey;
        this.useCachedPlaces = useCachedPlaces;

        if (this.cachePlaces) {
            Apify.events.on('migrating', async () => {
                const allPlacesStore = await this.placesStore();
                log.debug('Saving places before migration');
                const reloadedPlaces = (await allPlacesStore.getValue(this.keyName())) || {};
                // @ts-ignore
                const newPlaces = { ...allPlaces, ...reloadedPlaces };
                await allPlacesStore.setValue(this.keyName(), newPlaces);
            });

            setInterval(async () => {
                log.debug('Saving places before migration');

            }, 600 * 1000);
        }
    }

    async placesStore() {
        return await Apify.openKeyValueStore(cachedPlacesName);
    }

    keyName() {
        return this.cacheKey ? `places-${this.cacheKey}` : 'places';
    }

    async loadPlaces() {
        const allPlacesStore = await this.placesStore();
        return (await allPlacesStore.getValue(this.keyName())) || {};
    }

    addLocation(placeId, location, keyword) {
        if (!this.cachePlaces) return null;
        let place = {};
        if (Array.isArray(this.allPlaces[placeId])) place.location = this.allPlaces[placeId]
        else if (this.allPlaces[placeId]) place.keywords = [...(place.keywords || []), keyword];
        else place = { location, keywords: [keyword] };
        this.allPlaces[placeId] = place;
    }

    getLocation(placeId) {
        if (!this.cachePlaces || !this.allPlaces[placeId]) return null;
        if (Array.isArray(this.allPlaces[placeId]))
            return this.allPlaces[placeId];
        return this.allPlaces[placeId].location;
    }

    async loadInfo() {
        if (this.cachePlaces) {
            log.debug('Load cached places');
            this.allPlaces = this.loadPlaces();
            log.debug('allPlaces', this.allPlaces);
            log.info('[CACHE] cached places loaded.');
        } else log.info('[CACHE] Not enabled.');

        // mark as loaded
        this.isLoaded = true;
    }

    async savePlaces() {
        if (!this.isLoaded) throw new Error('Cannot save before loading old data!');

        const allPlacesStore = await this.placesStore();
        const reloadedPlaces = this.loadPlaces();
        // @ts-ignore
        const newPlaces = { ...this.allPlaces, ...reloadedPlaces };
        await allPlacesStore.setValue(this.keyName(), newPlaces);
        log.info('[CACHE] places saved');
    }

    placesInPolygon(geo, maxCrawledPlaces) {
        const arr = [];
        for (const placeId in this.allPlaces) {
            if (checkInPolygon(geo, this.allPlaces[placeId]))
                arr.push(placeId);
            if (maxCrawledPlaces && maxCrawledPlaces !== 0 && arr.length >= maxCrawledPlaces)
                break;
        }
        return arr;
    }
};
