const Apify = require('apify');
const { utils: { log } } = Apify;
const { checkInPolygon } = require('./polygon');
const cachedPlacesName = 'Places-cached-locations';

const PlacesCache = class PlacesCache {
    cachePlaces;
    allPlaces = {};
    isLoaded = false;

    constructor({ cachePlaces = false, cacheKey, useCachedPlaces }) {
        this.cachePlaces = cachePlaces;
        this.cacheKey = cacheKey;
        this.useCachedPlaces = useCachedPlaces;
    }

    async initialize() {
        if (this.cachePlaces) {
            log.debug('Load cached places');
            this.allPlaces = await this.loadPlaces();
            log.info('[CACHE] cached places loaded.');

            Apify.events.on('persistState', async () => {
                await this.savePlaces();
            });
        } else log.info('[CACHE] Not enabled.');

        // mark as loaded
        this.isLoaded = true;
    }

    async loadPlaces() {
        const allPlacesStore = await this.placesStore();
        return (await allPlacesStore.getValue(this.keyName())) || {};
    }

    async placesStore() {
        return await Apify.openKeyValueStore(cachedPlacesName);
    }

    keyName() {
        return this.cacheKey ? `places-${this.cacheKey}` : 'places';
    }

    addLocation(placeId, location, keyword) {
        if (!this.cachePlaces) return;
        let place = this.place(placeId) || { location, keywords: [] };
        place.keywords = [...(place.keywords || []), keyword];
        this.allPlaces[placeId] = place;
    }

    place(placeId) {
        if (!this.cachePlaces || !this.allPlaces[placeId]) return null;
        if (this.allPlaces[placeId].lat)
            return { location: this.allPlaces[placeId], keywords: [] };
        return this.allPlaces[placeId];
    }

    getLocation(placeId) {
        if (!this.cachePlaces || !this.place(placeId)) return null;
        return this.place(placeId).location;
    }

    async savePlaces() {
        if (!this.isLoaded) throw new Error('Cannot save before loading old data!');

        const allPlacesStore = await this.placesStore();
        const reloadedPlaces = await this.loadPlaces();
        // @ts-ignore
        const newPlaces = { ...reloadedPlaces, ...this.allPlaces };
        await allPlacesStore.setValue(this.keyName(), newPlaces);
        log.info('[CACHE] places saved');
    }

    placesInPolygon(geo, maxCrawledPlaces, keywords = []) {
        const arr = [];
        if (!this.cachePlaces || !this.useCachedPlaces) return arr;
        for (const placeId in this.allPlaces) {
            // check if cached location is desired polygon and has at least one search string currently needed
            if (checkInPolygon(geo, this.getLocation(placeId)) &&
                (this.place(placeId).keywords.length === 0 || this.place(placeId).keywords.filter(x => keywords.includes(x)).length > 0))
                arr.push(placeId);
            if (maxCrawledPlaces && maxCrawledPlaces !== 0 && arr.length >= maxCrawledPlaces)
                break;
        }
        return arr;
    }
};

module.exports = PlacesCache;
