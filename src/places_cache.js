const Apify = require('apify');
const { utils: { log } } = Apify;
const { checkInPolygon } = require('./polygon');
const cachedPlacesName = 'Places-cached-locations';

exports.PlacesCache = class PlacesCache {
    cachePlaces;
    allPlaces = {};
    isLoaded = false;

    constructor(cachePlaces = false) {
        this.cachePlaces = cachePlaces;

        if (this.cachePlaces) {
            Apify.events.on('migrating', async () => {
                log.debug('Saving places before migration');
                const reloadedPlaces = (await allPlacesStore.getValue('places')) || {};
                // @ts-ignore
                const newPlaces = { ...allPlaces, ...reloadedPlaces };
                await allPlacesStore.setValue('places', newPlaces);
            });

            setInterval(async () => {
                log.debug('Saving places before migration');

            }, 600 * 1000);
        }
    }

    async placesStore() {
        return Apify.openKeyValueStore(cachedPlacesName);
    }

    async loadPlaces() {
        const allPlacesStore = await this.placesStore();
        return (await allPlacesStore.getValue('places')) || {};
    }

    addLocation(placeId, location) {
        if (this.cachePlaces)
            this.allPlaces[placeId] = location;
    }

    getLocation(placeId) {
        if (this.cachePlaces)
            return this.allPlaces[placeId];
        return null;
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
        await allPlacesStore.setValue('places', newPlaces);
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
