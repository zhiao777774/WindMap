/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var products = function () {
    "use strict";

    var WEATHER_PATH = "data/weather";
    var OSCAR_PATH = "data/oscar";
    // var catalogs = {
    //     // The OSCAR catalog is an array of file names, sorted and prefixed with yyyyMMdd. Last item is the
    //     // most recent. For example: [ 20140101-abc.json, 20140106-abc.json, 20140112-abc.json, ... ]
    //     oscar: µ.loadJson([OSCAR_PATH, "catalog.json"].join("/"))
    // };

    function buildProduct(overrides) {
        return _.extend({
            description: "",
            paths: [],
            date: null,
            load: function (cancel) {
                var me = this;
                return when.map(this.paths, _loadJson).then(function (files) {
                    return cancel.requested ? null : _.extend(me, buildGrid(me.builder.apply(me, files)));
                });
            }
        }, overrides);
    }

    function _loadJson(resource) {
        var d = when.defer();
        var loadPath = resource;

        d3.json(loadPath, function (error, result) {
            return error ?
                !error.status ?
                    d.reject({ status: -1, message: "Cannot load resource: " + resource, resource: resource }) :
                    d.reject({ status: error.status, message: error.statusText, resource: resource }) :
                d.resolve(result);
        });
        return d.promise;
    }

    /**
     * @param attr
     * @param {String} type
     * @param {String?} surface
     * @param {String?} level
     * @returns {String}
     */
    function gfs1p0degPath(attr, type, surface, level) {
        var dir = attr.date, stamp = dir === "current" ? "current" : attr.hour;
        var file = [stamp, type, surface, level, "gfs", "1.0"].filter(µ.isValue).join("-") + ".json";
        return [WEATHER_PATH, dir, file].join("/");
    }
    function cwb1p0degPath(attr, type) {
        var datetimeStamp = attr.date.replace(/\//g, ''), stamp = datetimeStamp === "current" ? "current" : attr.hour.substr(0, 2);
        var lev = attr.level === "sfc" ? "SFC" : attr.level;
        var file = [stamp, type, lev].filter(µ.isValue).join("_") + ".json";
        if (stamp !== "current")
            file = [datetimeStamp, file].join("");
        return [WEATHER_PATH, file].join("/");
    }
    function cwb1p0degTPath(attr, type) {
        var datetimeStamp = attr.date.replace(/\//g, ''), stamp = datetimeStamp === "current" ? "current" : attr.hour.substr(0, 2);
        var lev = attr.level === "sfc" ? "LSFC" : attr.level;
        var file = [stamp, type, lev].filter(µ.isValue).join("_") + ".json";
        if (stamp !== "current")
            file = [datetimeStamp, file].join("");
        return [WEATHER_PATH, file].join("/");
    }

    function cwb1p0degNonLevelPath(attr, type, key) {
        var datetimeStamp = attr.date.replace(/\//g, ''), stamp = datetimeStamp === "current" ? "current" : attr.hour.substr(0, 2);
        var file = [stamp, type, key].filter(µ.isValue).join("_") + ".json";
        if (stamp !== "current")
            file = [datetimeStamp, file].join("");
        return [WEATHER_PATH, file].join("/");
    }

    function gfsDate(attr) {
        if (attr.date === "current") {
            // Construct the date from the current time, rounding down to the nearest three-hour block.
            var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
        }
        var parts = attr.date.split("/");
        return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
    }

    /**
     * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
     * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
     */
    function gfsStep(date, step) {
        //var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
        var offset = (step > 1 ? 4 : step < -1 ? -4 : step) * 6, adjusted = new Date(date);
        adjusted.setHours(adjusted.getHours() + offset);
        return adjusted;
    }

    function netcdfHeader(time, lat, lon, center) {
        return {
            lo1: lon.sequence.start,
            la1: lat.sequence.start,
            dx: lon.sequence.delta,
            dy: -lat.sequence.delta,
            nx: lon.sequence.size,
            ny: lat.sequence.size,
            refTime: time.data[0],
            forecastTime: 0,
            centerName: center
        };
    }

    function describeSurface(attr) {
        return attr.surface === "surface" ? "Surface" : µ.capitalize(attr.level);
    }

    function describeSurfaceJa(attr) {
        return attr.surface === "surface" ? "地上" : µ.capitalize(attr.level);
    }

    /**
     * Returns a function f(langCode) that, given table:
     *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
     * will return the following when called with "en":
     *     {foo: "A", bar: "I"}
     * or when called with "ja":
     *     {foo: "あ", bar: "い"}
     */
    function localize(table) {
        return function (langCode) {
            var result = {};
            _.each(table, function (value, key) {
                result[key] = value[langCode] || value.en || value;
            });
            return result;
        }
    }

    var FACTORIES = {

        "wind": {
            matches: _.matches({ param: "wind" }),
            create: function (attr) {
                return buildProduct({
                    field: "vector",
                    type: "wind",
                    description: localize({
                        name: { en: "Wind", ja: "風速" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    //paths: [gfs1p0degPath(attr, "wind", attr.surface, attr.level)],
                    paths: ['https://cors-anywhere.herokuapp.com/https://www.cwb.gov.tw/cwbwifi/' + cwb1p0degPath(attr, "UV")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var uData = file[0].data, vData = file[1].data;
                        return {
                            header: file[0].header,
                            field: "vector",
                            interpolate: bilinearInterpolateVector,
                            uData: file[0].data,
                            vData: file[1].data,
                            // data: function (i) {
                            //     return [uData[i], vData[i]];
                            // }
                        }
                    },
                    units: [
                        { label: "m/s", conversion: function (x) { return x; }, precision: 1 },
                        { label: "km/h", conversion: function (x) { return Math.round(x * 3.6); }, precision: 0 },
                        { label: "kn", conversion: function (x) { return Math.round(x * 1.943844); }, precision: 0 },
                        { label: "mph", conversion: function (x) { return Math.round(x * 2.236936); }, precision: 0 }
                    ],
                    scale: {
                        bounds: [0, 35],
                        gradient: µ.segmentedColorScale([
                            [0, [37, 74, 255, 0.6]],
                            [2, [0, 150, 254, 0.6]],
                            [4, [18, 196, 200, 0.6]],
                            [6, [18, 211, 73, 0.6]],
                            [8, [0, 240, 0, 0.6]],
                            [10, [127, 237, 0, 0.6]],
                            [12, [254, 199, 0, 0.6]],
                            [14, [237, 124, 14, 0.6]],
                            [16, [200, 37, 39, 0.6]],
                            [18, [217, 0, 100, 0.6]],
                            [20, [202, 25, 186, 0.6]],
                            [24, [86, 54, 222, 0.6]],
                            [27, [42, 132, 222, 0.6]],
                            [29, [64, 199, 222, 0.6]]
                        ]),
                        range: [
                            [0, [37, 74, 255, 0.6]],
                            [2, [0, 150, 254, 0.6]],
                            [4, [18, 196, 200, 0.6]],
                            [6, [18, 211, 73, 0.6]],
                            [8, [0, 240, 0, 0.6]],
                            [10, [127, 237, 0, 0.6]],
                            [12, [254, 199, 0, 0.6]],
                            [14, [237, 124, 14, 0.6]],
                            [16, [200, 37, 39, 0.6]],
                            [18, [217, 0, 100, 0.6]],
                            [20, [202, 25, 186, 0.6]],
                            [24, [86, 54, 222, 0.6]],
                            [27, [42, 132, 222, 0.6]],
                            [29, [64, 199, 222, 0.6]]
                        ]
                        //gradient: function (v, a) {
                        //    return µ.extendedSinebowColor(Math.min(v, 100) / 100, a);
                        //}
                    },
                    particles: { velocityScale: 1 / 200000, maxIntensity: 17 }
                });
            }
        },

        "temp": {
            matches: _.matches({ param: "wind", overlayType: "temp" }),
            create: function (attr) {
                return buildProduct({
                    field: "scalar",
                    type: "temp",
                    description: localize({
                        name: { en: "Temp", ja: "気温" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    //paths: [gfs1p0degPath(attr, "temp", attr.surface, attr.level)],
                    paths: [cwb1p0degPath(attr, "T")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            // data: function (i) {
                            //     return data[i];
                            // }
                            data: data
                        }
                    },
                    units: [
                        { label: "°C", conversion: function (x) { return Math.round(x - 273.15); }, precision: 0 },
                        { label: "°F", conversion: function (x) { return Math.round(x * 9 / 5 - 459.67); }, precision: 0 }
                        //,
                        //{ label: "K", conversion: function (x) { return x; }, precision: 1 }
                    ],
                    scale: {
                        bounds: [193, 328],
                        gradient: µ.segmentedColorScale([
                            [238.15, [171, 66, 160, 0.6]],  // -35 C
                            [243.15, [145, 104, 174, 0.6]],
                            [248.15, [115, 147, 190, 0.6]],
                            [253.15, [90, 185, 204, 0.6]],
                            [258.15, [67, 207, 213, 0.6]],
                            [263.15, [52, 167, 204, 0.6]],
                            [268.15, [39, 132, 197, 0.6]],
                            [273.15, [24, 92, 188, 0.6]],   // 0 C
                            [278.15, [45, 143, 18, 0.6]],
                            [283.15, [112, 179, 31, 0.6]],
                            [288.15, [188, 219, 47, 0.6]],
                            [293.15, [246, 244, 56, 0.6]],
                            [298.15, [236, 179, 26, 0.6]],
                            [303.15, [233, 139, 26, 0.6]],
                            [308.15, [231, 104, 32, 0.6]]   //35 C
                        ]),
                        range: [
                            [238.15, [171, 66, 160, 0.6]],  // -35 C
                            [243.15, [145, 104, 174, 0.6]],
                            [248.15, [115, 147, 190, 0.6]],
                            [253.15, [90, 185, 204, 0.6]],
                            [258.15, [67, 207, 213, 0.6]],
                            [263.15, [52, 167, 204, 0.6]],
                            [268.15, [39, 132, 197, 0.6]],
                            [273.15, [24, 92, 188, 0.6]],   // 0 C
                            [278.15, [45, 143, 18, 0.6]],
                            [283.15, [112, 179, 31, 0.6]],
                            [288.15, [188, 219, 47, 0.6]],
                            [293.15, [246, 244, 56, 0.6]],
                            [298.15, [236, 179, 26, 0.6]],
                            [303.15, [233, 139, 26, 0.6]],
                            [308.15, [231, 104, 32, 0.6]]   //35 C
                        ]
                    }
                });
            }
        },
        "pres": {
            matches: _.matches({ param: "wind", overlayType: "pres" }),
            create: function (attr) {
                return buildProduct({
                    field: "scalar",
                    type: "pres",
                    description: localize({
                        name: { en: "Pressure", ja: "氣壓" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    paths: [cwb1p0degNonLevelPath(attr, "PRES", "SFC")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            // data: function (i) {
                            //     return data[i];
                            // }
                            data: data
                        }
                    },
                    units: [
                        { label: "hPa", conversion: function (x) { return x; }, precision: 0 }
                    ],
                    scale: {
                        bounds: [990, 1050],
                        gradient: µ.segmentedColorScale([
                            [995, [40, 9, 119, 0.6]],
                            [998, [61, 25, 83, 0.6]],
                            [1001, [110, 39, 69, 0.6]],
                            [1004, [151, 96, 171, 0.6]],
                            [1007, [63, 197, 211, 0.6]],
                            [1010, [21, 88, 169, 0.6]],
                            [1013, [22, 114, 77, 0.6]],
                            [1016, [79, 161, 25, 0.6]],
                            [1019, [213, 233, 52, 0.6]],
                            [1022, [236, 178, 26, 0.6]],
                            [1025, [230, 77, 37, 0.6]],
                            [1028, [144, 44, 55, 0.6]]
                        ]),
                        range: [
                            [995, [40, 9, 119, 0.6]],
                            [998, [61, 25, 83, 0.6]],
                            [1001, [110, 39, 69, 0.6]],
                            [1004, [151, 96, 171, 0.6]],
                            [1007, [63, 197, 211, 0.6]],
                            [1010, [21, 88, 169, 0.6]],
                            [1013, [22, 114, 77, 0.6]],
                            [1016, [79, 161, 25, 0.6]],
                            [1019, [213, 233, 52, 0.6]],
                            [1022, [236, 178, 26, 0.6]],
                            [1025, [230, 77, 37, 0.6]],
                            [1028, [144, 44, 55, 0.6]]
                        ]
                    }
                });
            }
        },
        "taprecip": {
            matches: _.matches({ param: "wind", overlayType: "taprecip" }),
            create: function (attr) {
                return buildProduct({
                    field: "scalar",
                    type: "taprecip",
                    description: localize({
                        name: { en: "taprecip", ja: "雨量" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    paths: [cwb1p0degNonLevelPath(attr, "TAPRECIP", "SFC")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            // data: function (i) {
                            //     return data[i];
                            // }
                            data: data
                        }
                    },
                    units: [
                        { label: "mm", conversion: function (x) { return x; }, precision: 0 }
                    ],
                    scale: {
                        bounds: [0, 3000],
                        gradient: µ.segmentedColorScale([
                            [0, [60, 60, 60, 0.6]],
                            [5, [107, 63, 180, 0.6]],
                            [10, [107, 63, 180, 0.6]],
                            [20, [27, 160, 223, 0.6]],
                            [30, [13, 192, 190, 0.6]],
                            [40, [0, 225, 158, 0.6]],
                            [100, [243, 145, 42, 0.6]],
                            [1000, [229, 60, 151, 0.6]],
                            [3000, [197, 60, 158, 0.6]]
                        ]),
                        range: [
                            [0, [60, 60, 60, 0.6]],
                            [5, [107, 63, 180, 0.6]],
                            [10, [107, 63, 180, 0.6]],
                            [20, [27, 160, 223, 0.6]],
                            [30, [13, 192, 190, 0.6]],
                            [40, [0, 225, 158, 0.6]],
                            [100, [243, 145, 42, 0.6]],
                            [1000, [229, 60, 151, 0.6]],
                            [3000, [197, 60, 158, 0.6]]
                        ]
                    }
                });
            }
        },
        "cloud": {
            matches: _.matches({ param: "wind", overlayType: "cloud" }),
            create: function (attr) {
                return buildProduct({
                    field: "scalar",
                    type: "cloud",
                    description: localize({
                        name: { en: "Cloud", ja: "雲量" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    paths: [cwb1p0degNonLevelPath(attr, "CLOUD", "ALL")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            // data: function (i) {
                            //     return data[i];
                            // }
                            data: data
                        }
                    },
                    units: [
                        { label: "", conversion: function (x) { return x; }, precision: 0 }
                    ],
                    scale: {
                        bounds: [0, 10],
                        gradient: µ.segmentedColorScale([
                            [0, [53, 53, 53, 0.6]],
                            [1, [102, 102, 102, 0.6]],
                            [2, [130, 130, 130, 0.6]],
                            [3, [158, 158, 158, 0.6]],
                            [4, [173, 173, 173, 0.6]],
                            [5, [191, 191, 191, 0.6]],
                            [6, [204, 204, 204, 0.6]],
                            [7, [217, 217, 217, 0.6]],
                            [8, [232, 232, 232, 0.6]],
                            [9, [242, 242, 242, 0.6]],
                            [10, [255, 255, 255, 0.6]]
                        ]),
                        range: [
                            [0, [53, 53, 53, 0.6]],
                            [1, [102, 102, 102, 0.6]],
                            [2, [130, 130, 130, 0.6]],
                            [3, [158, 158, 158, 0.6]],
                            [4, [173, 173, 173, 0.6]],
                            [5, [191, 191, 191, 0.6]],
                            [6, [204, 204, 204, 0.6]],
                            [7, [217, 217, 217, 0.6]],
                            [8, [232, 232, 232, 0.6]],
                            [9, [242, 242, 242, 0.6]],
                            [10, [255, 255, 255, 0.6]]
                        ]

                    }
                });
            }
        },
        "htsgwo": {
            matches: _.matches({ param: "ocean"}),
            create: function (attr) {
                return buildProduct({
                    field: "vector",
                    type: "htsgwo",
                    description: localize({
                        name: { en: "Ocean Currents", ja: "海流" },
                        qualifier: { en: " @ Surface", ja: " @ 地上" }
                    }),
                    paths: [cwbOscarFilePath(attr)],
                    // date: oscarDate(catalog, attr),
                    date: gfsDate(attr),
                    builder: function (file) {
                        var uData = file[0].data, vData = file[1].data;
                        return {
                            header: file[0].header,
                            field: "vector",
                            interpolate: bilinearInterpolateVector,
                            uData: file[0].data,
                            vData: file[1].data,
                            // data: function (i) {
                            //     var u = uData[i], v = vData[i];
                            //     return µ.isValue(u) && µ.isValue(v) ? [u, v] : null;
                            // }
                        }
                    },
                    units: [
                        { label: "", conversion: function (x) { return x; }, precision: 0 }
                    ],
                    scale: {
                        bounds: [0, 10],
                        gradient: µ.segmentedColorScale([
                            // [-1, [53, 53, 53, 0.6]],
                            [0, [159, 185, 191, 0.75]],
                            [1, [48, 157, 185, 0.75]],
                            [2, [48, 98, 141, 0.75]],
                            [3, [56, 104, 191, 0.75]],
                            [4, [57, 60, 142, 0.75]],
                            [5, [187, 90, 191, 0.75]],
                            [6, [154, 48, 151, 0.75]],
                            [7, [133, 48, 8, 0.75]],
                            [8, [191, 51, 95, 0.75]],
                            [9, [191, 103, 87, 0.75]],
                            [10, [191, 191, 191, 0.75]],
                            [11, [154, 127, 155, 0.75]],
                            [12, [255, 0, 150, 0.75]],
                            [13, [255, 0, 200, 0.75]],
                            [14, [255, 0, 250, 0.75]],
                            [15, [255, 50, 255, 0.75]]
                        ]),
                        range: [
                            // [-1, [53, 53, 53, 0.6]],
                            [0, [159, 185, 191, 0.75]],
                            [1, [48, 157, 185, 0.75]],
                            [2, [48, 98, 141, 0.75]],
                            [3, [56, 104, 191, 0.75]],
                            [4, [57, 60, 142, 0.75]],
                            [5, [187, 90, 191, 0.75]],
                            [6, [154, 48, 151, 0.75]],
                            [7, [133, 48, 8, 0.75]],
                            [8, [191, 51, 95, 0.75]],
                            [9, [191, 103, 87, 0.75]],
                            [10, [191, 191, 191, 0.75]],
                            [11, [154, 127, 155, 0.75]],
                            [12, [255, 0, 150, 0.75]],
                            [13, [255, 0, 200, 0.75]],
                            [14, [255, 0, 250, 0.75]],
                            [15, [255, 50, 255, 0.75]]
                        ]

                    },
                    particles: { velocityScale: 1 / 101200, maxIntensity: 12, waves: true }
                });
            }
        },
        "htsgw": {
            matches: _.matches({ param: "ocean", overlayType: "htsgw" }),
            create: function (attr) {
                return buildProduct({
                    field: "scalar",
                    type: "htsgw",
                    description: localize({
                        name: { en: "htsgw" },
                        qualifier: { en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr) }
                    }),
                    paths: [cwb1p0degNonLevelPath(attr, "HTSGW", "WSFC")],
                    date: gfsDate(attr),
                    builder: function (file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            // data: function (i) {
                            //     return data[i];
                            // }
                            data: data
                        }
                    },
                    units: [
                        { label: "m", conversion: function (x) { return x; }, precision: 0 }
                    ],
                    scale: {
                        bounds: [0, 10],
                        gradient: µ.segmentedColorScale([
                            [0, [49, 158, 185, 1]],
                            [0.5, [49, 158, 185, 1]],
                            [0.75, [47, 128, 164, 1]],
                            [1, [48, 98, 141, 1]],
                            [1.25, [51, 101, 166, 1]],
                            [1.5, [56, 104, 191, 1]],
                            [1.75, [56, 82, 168, 1]],
                            [2, [57, 60, 143, 1]],
                            [2.5, [187, 89, 191, 1]],
                            [3, [154, 48, 150, 1]],
                            [3.5, [151, 43, 100, 1]],
                            [4, [133, 48, 48, 1]],
                            [4.5, [162, 49, 71, 1]],
                            [5, [191, 51, 95, 1]],
                            [5.5, [192, 61, 93, 1]],
                            [6, [193, 76, 90, 1]],
                            [6.5, [193, 90, 88, 1]],
                            [7, [191, 105, 88, 1]],
                            [7.5, [191, 118, 104, 1]],
                            [8, [191, 130, 119, 1]],
                            [8.5, [191, 150, 142, 1]],
                            [9, [191, 162, 156, 1]],
                            [10, [191, 162, 156, 1]]
                        ]),
                        range: [
                            [0, [49, 158, 185, 1]],
                            [0.5, [49, 158, 185, 1]],
                            [1, [48, 98, 141, 1]],
                            [2, [57, 60, 143, 1]],
                            [4, [133, 48, 48, 1]],
                            [6, [193, 76, 90, 1]],
                            [9, [191, 162, 156, 1]],
                            [10, [191, 162, 156, 1]]
                        ]

                    }
                });
            }
        },

        "off": {
            matches: _.matches({ overlayType: "off" }),
            create: function () {
                return null;
            }
        }
    };

    /**
     * Returns the file name for the most recent OSCAR data layer to the specified date. If offset is non-zero,
     * the file name that many entries from the most recent is returned.
     *
     * The result is undefined if there is no entry for the specified date and offset can be found.
     *
     * UNDONE: the catalog object itself should encapsulate this logic. GFS can also be a "virtual" catalog, and
     *         provide a mechanism for eliminating the need for /data/weather/current/* files.
     *
     * @param {Array} catalog array of file names, sorted and prefixed with yyyyMMdd. Last item is most recent.
     * @param {String} date string with format yyyy/MM/dd or "current"
     * @param {Number?} offset
     * @returns {String} file name
     */
    function lookupOscar(catalog, date, offset) {
        offset = +offset || 0;
        if (date === "current") {
            return catalog[catalog.length - 1 + offset];
        }
        var prefix = µ.ymdRedelimit(date, "/", ""), i = _.sortedIndex(catalog, prefix);
        i = (catalog[i] || "").indexOf(prefix) === 0 ? i : i - 1;
        return catalog[i + offset];
    }

    function cwbOscarFilePath(attr){
        var type = 'UV';
        var lev = 'WSFC';
        var datetimeStamp = attr.date.replace(/\//g, ''), stamp = datetimeStamp === "current" ? "current" : attr.hour.substr(0, 2);
        var file = [stamp, type, lev].filter(µ.isValue).join("_") + ".json";
        if (stamp !== "current")
            file = [datetimeStamp, file].join("");
        return [WEATHER_PATH, file].join("/");
        // return [OSCAR_PATH, file].join("/");
    }

    function oscar0p33Path(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        return file ? [OSCAR_PATH, file].join("/") : null;
    }

    function oscarDate(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    /**
     * @returns {Date} the chronologically next or previous OSCAR data layer. How far forward or backward in
     * time to jump is determined by the step and the catalog of available layers. A step of ±1 moves to the
     * next/previous entry in the catalog (about 5 days), and a step of ±10 moves to the entry six positions away
     * (about 30 days).
     */
    function oscarStep(catalog, date, step) {
        var file = lookupOscar(catalog, µ.dateToUTCymd(date, "/"), step > 1 ? 6 : step < -1 ? -6 : step);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    function dataSource(header) {
        // noinspection FallthroughInSwitchStatementJS
        switch (header.center || header.centerName) {
            case -3:
                return "OSCAR / Earth & Space Research";
            case 7:
            case "US National Weather Service, National Centres for Environmental Prediction (NCEP)":
                return "GFS / NCEP / US National Weather Service";
            default:
                return header.centerName;
        }
    }

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry, b = x * ry, c = rx * y, d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    /**
     * Builds an interpolator for the specified data in the form of JSON-ified GRIB files. Example:
     *
     *     [
     *       {
     *         "header": {
     *           "refTime": "2013-11-30T18:00:00.000Z",
     *           "parameterCategory": 2,
     *           "parameterNumber": 2,
     *           "surface1Type": 100,
     *           "surface1Value": 100000.0,
     *           "forecastTime": 6,
     *           "scanMode": 0,
     *           "nx": 360,
     *           "ny": 181,
     *           "lo1": 0,
     *           "la1": 90,
     *           "lo2": 359,
     *           "la2": -90,
     *           "dx": 1,
     *           "dy": 1
     *         },
     *         "data": [3.42, 3.31, 3.19, 3.08, 2.96, 2.84, 2.72, 2.6, 2.47, ...]
     *       }
     *     ]
     *
     */

    function buildGrid(builder) {
        // var builder = createBuilder(data);
        var header = builder.header;
        var λ0 = header.lo1, λ1 = header.lo2, φ0 = header.la1, φ1 = header.la2;  // the grid's origin (e.g., 0.0E, 90.0N)
        var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
        var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
        var date = new Date(header.refTime);
        var reversionRow = true;
        if (φ1 > φ0) { var φt = φ0; φ0 = φ1; φ1 = φt; reversionRow = true; }
        date.setHours(date.getHours() + header.forecastTime);
        // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
        // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        var gridNumber = ni * nj;
        var interpolate, forEachPoint;
        if (builder.field && builder.field === 'vector' && true) {
            var uGrid = new Float32Array(gridNumber);
            var vGrid = new Float32Array(gridNumber);
            if (reversionRow) {
                for (var j = 0; j < nj; j++) {
                    for (var i = 0; i < ni; i++) {
                        uGrid[(nj - 1 - j) * ni + i] = builder.uData[j * ni + i] == null ? 9999 : builder.uData[j * ni + i];
                        vGrid[(nj - 1 - j) * ni + i] = builder.vData[j * ni + i] == null ? 9999 : builder.vData[j * ni + i];
                    }
                }
            } else {
                for (var gi = 0; gi < gridNumber; gi++) {
                    uGrid[gi] = builder.uData[gi] == null ? 9999 : builder.uData[gi];
                    vGrid[gi] = builder.uData[gi] == null ? 9999 : builder.vData[gi];
                }
            }
            interpolate = function (λ, φ) {
                var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
                var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90
                var fi = Math.floor(i), ci = fi + 1;
                var fj = Math.floor(j), cj = fj + 1;
                if (fi < 0 || ci >= ni || fj < 0 || cj >= nj) return null;
                var ug00 = uGrid[ni * fj + fi];
                var ug10 = uGrid[ni * fj + ci];
                var ug01 = uGrid[ni * cj + fi];
                var ug11 = uGrid[ni * cj + ci];
                var vg00 = vGrid[ni * fj + fi];
                var vg10 = vGrid[ni * fj + ci];
                var vg01 = vGrid[ni * cj + fi];
                var vg11 = vGrid[ni * cj + ci];
                if (ug00 === 9999 || ug10 === 9999 || ug01 === 9999 || ug11 === 9999 ||
                    vg00 === 9999 || vg01 === 9999 || vg10 === 9999 || vg11 === 9999) return null;
                var x = i - fi;
                var y = j - fj;
                var rx = (1 - x);
                var ry = (1 - y);
                var a = rx * ry, b = x * ry, c = rx * y, d = x * y;
                var u = ug00 * a + ug10 * b + ug01 * c + ug11 * d;
                var v = vg00 * a + vg10 * b + vg01 * c + vg11 * d;
                var m = Math.sqrt(u * u + v * v);
                return [u, v, m];
            }
            forEachPoint = function (cb) {
                for (var j = 0; j < nj; j++) {
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, [uGrid[i + j * ni], vGrid[i + j * ni]]);
                    }
                }
            }
        } else {
            var grid = new Float32Array(gridNumber);
            if (reversionRow) {
                for (var j = 0; j < nj; j++) {
                    for (var i = 0; i < ni; i++) {
                        grid[(nj - 1 - j) * ni + i] = builder.data[j * ni + i] == null ? 9999 : builder.data[j * ni + i];
                    }
                }
            } else {
                for (var gi = 0; gi < gridNumber; gi++) {
                    grid[gi] = builder.data[gi] == null ? 9999 : builder.data[gi];
                }
            }

            interpolate = function (λ, φ) {
                var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
                var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

                //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
                //        fi  i   ci          four points "G" that enclose point (i, j). These points are at the four
                //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
                //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
                //    j ___|_ .   |           (1, 9) and (2, 9).
                //  =8.3   |      |
                //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
                //         |      |           column, so the index ci can be used without taking a modulo.

                var fi = Math.floor(i), ci = fi + 1;
                var fj = Math.floor(j), cj = fj + 1;
                if (fi < 0 || ci >= ni || fj < 0 || cj >= nj) return null;
                var g00 = grid[ni * fj + fi];
                var g10 = grid[ni * fj + ci];
                var g01 = grid[ni * cj + fi];
                var g11 = grid[ni * cj + ci];
                if (g00 === 9999 || g10 === 9999 || g01 === 9999 || g11 === 9999) return null;
                var x = i - fi;
                var y = j - fj;
                var rx = (1 - x);
                var ry = (1 - y);
                return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
            }
            forEachPoint = function (cb) {
                for (var j = 0; j < nj; j++) {
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, grid[i + j * ni]);
                    }
                }
            }
        }

        return {
            source: dataSource(header),
            date: date,
            interpolate: interpolate,
            forEachPoint: forEachPoint
        };
    }
    function buildGridOld(builder) {
        // var builder = createBuilder(data);
        var header = builder.header;
        var λ0 = header.lo1, φ0 = header.la1, φ1 = header.la2;  // the grid's origin (e.g., 0.0E, 90.0N)
        var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
        var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
        var date = new Date(header.refTime);
        var reversionRow = true;
        if (φ1 > φ0) { var φt = φ0; φ0 = φ1; φ1 = φt; reversionRow = true; }
        date.setHours(date.getHours() + header.forecastTime);
        // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
        // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var grid = [], p = 0;
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        if (reversionRow) {
            for (var j = 0; j < nj; j++) {
                var row = [];
                for (var i = 0; i < ni; i++, p++) {
                    row[i] = builder.data[p];
                }
                if (isContinuous) {
                    // For wrapped grids, duplicate first column as last column to simplify interpolation logic
                    row.push(row[0]);
                }
                grid[nj - 1 - j] = row;
            }
        }
        else {
            for (var j = 0; j < nj; j++) {
                var row = [];
                for (var i = 0; i < ni; i++, p++) {
                    row[i] = builder.data[p];
                }
                if (isContinuous) {
                    // For wrapped grids, duplicate first column as last column to simplify interpolation logic
                    row.push(row[0]);
                }
                grid[j] = row;
            }
        }
        function interpolate(λ, φ) {
            var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
            var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

            //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
            //        fi  i   ci          four points "G" that enclose point (i, j). These points are at the four
            //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
            //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
            //    j ___|_ .   |           (1, 9) and (2, 9).
            //  =8.3   |      |
            //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
            //         |      |           column, so the index ci can be used without taking a modulo.

            var fi = Math.floor(i), ci = fi + 1;
            var fj = Math.floor(j), cj = fj + 1;
            var row;
            if ((row = grid[fj])) {
                var g00 = row[fi];
                var g10 = row[ci];
                if (µ.isValue(g00) && µ.isValue(g10) && (row = grid[cj])) {
                    var g01 = row[fi];
                    var g11 = row[ci];
                    if (µ.isValue(g01) && µ.isValue(g11)) {
                        // All four points found, so interpolate the value.
                        return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                    }
                }
            }
            return null;
        }

        return {
            source: dataSource(header),
            date: date,
            interpolate: interpolate,
            forEachPoint: function (cb) {
                for (var j = 0; j < nj; j++) {
                    var row = grid[j] || [];
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, row[i]);
                    }
                }
            }
        };
    }

    function productsFor(attributes) {
        var attr = _.clone(attributes), results = [];
        _.values(FACTORIES).forEach(function (factory) {
            if (factory.matches(attr)) {
                results.push(factory.create(attr));
            }
        });
        return results.filter(µ.isValue);
    }

    return {
        overlayTypes: d3.set(_.keys(FACTORIES)),
        productsFor: productsFor
    };

}();
