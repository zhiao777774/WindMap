/**
 * earth - a project to visualize global air data.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
(function () {
    "use strict";

    var SECOND = 1000;
    var MINUTE = 60 * SECOND;
    var HOUR = 60 * MINUTE;
    var MAX_TASK_TIME = 100;                  // amount of time before a task yields control (millis)
    var MIN_SLEEP_TIME = 25;                  // amount of time a task waits before resuming (millis)
    var MIN_MOVE = 4;                         // slack before a drag operation beings (pixels)
    var MOVE_END_WAIT = 10;                 // time to wait for a move operation to be considered done (millis)

    var OVERLAY_ALPHA = Math.floor(0.4 * 255);  // overlay transparency (on scale [0, 255])
    var INTENSITY_SCALE_STEP = 10;            // step size of particle intensity color scale
    var MAX_PARTICLE_AGE = 100;               // max number of frames a particle is drawn before regeneration
    var PARTICLE_LINE_WIDTH = 1.0;            // line width of a drawn particle
    var PARTICLE_MULTIPLIER = 3;              // particle count scalar (completely arbitrary--this values looks nice)
    var PARTICLE_REDUCTION = 0.75;            // reduce particle count to this much of normal for mobile devices
    var FRAME_RATE = 40;                      // desired milliseconds per frame

    var NULL_WIND_VECTOR = [NaN, NaN, null];  // singleton for undefined location outside the vector field [u, v, mag]
    var HOLE_VECTOR = [NaN, NaN, null];       // singleton that signifies a hole in the vector field
    var TRANSPARENT_BLACK = [0, 0, 0, 0];     // singleton 0 rgba
    var REMAINING = "▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫";   // glyphs for remaining progress bar
    var COMPLETED = "▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪";   // glyphs for completed progress bar

    var minifest = null;
    var view = µ.view();
    var log = µ.log();
    var play_anime = true;
    var isChangeData = false;

    /**
     * An object to display various types of messages to the user.
     */
    var report = function () {
        var s = d3.select("#status"), p = d3.select("#progress"), total = REMAINING.length;
        return {
            status: function (msg) {
                return s.classed("bad") ? s : s.text(msg);  // errors are sticky until reset
            },
            error: function (err) {
                var msg = err.status ? err.status + " " + err.message : err;
                switch (err.status) {
                    case -1: msg = "Server Down"; break;
                    case 404: msg = "No Data"; break;
                }
                log.error(err);
                return s.classed("bad", true).text(msg);
            },
            reset: function () {
                return s.classed("bad", false).text("");
            },
            progress: function (amount) {  // amount of progress to report in the range [0, 1]
                if (0 <= amount && amount < 1) {
                    var i = Math.ceil(amount * total);
                    var bar = COMPLETED.substr(0, i) + REMAINING.substr(0, total - i);
                    return p.classed("invisible", false).text(bar);
                }
                return p.classed("invisible", true).text("");  // progress complete
            }
        };
    }();

    function newAgent() {
        return µ.newAgent().on({ "reject": report.error, "fail": report.error });
    }

    // Construct the page's main internal components:

    var configuration =
        µ.buildConfiguration(globes, products.overlayTypes);  // holds the page's current configuration settings
    var inputController = buildInputController();             // interprets drag/zoom operations
    var meshAgent = newAgent();      // map data for the earth
    var globeAgent = newAgent();     // the model of the globe
    var gridAgent = newAgent();      // the grid of weather data
    var rendererAgent = newAgent();  // the globe SVG renderer
    var fieldAgent = newAgent();     // the interpolated wind vector field
    var animatorAgent = newAgent();  // the wind animator
    var overlayAgent = newAgent();   // color overlay over the animation
    var timelineAgent = newAgent();
    var calenderAgent = newAgent();
    /**
     * The input controller is an object that translates move operations (drag and/or zoom) into mutations of the
     * current globe's projection, and emits events so other page components can react to these move operations.
     *
     * D3's built-in Zoom behavior is used to bind to the document's drag/zoom events, and the input controller
     * interprets D3's events as move operations on the globe. This method is complicated due to the complex
     * event behavior that occurs during drag and zoom.
     *
     * D3 move operations usually occur as "zoomstart" -> ("zoom")* -> "zoomend" event chain. During "zoom" events
     * the scale and mouse may change, implying a zoom or drag operation accordingly. These operations are quite
     * noisy. What should otherwise be one smooth continuous zoom is usually comprised of several "zoomstart" ->
     * "zoom" -> "zoomend" event chains. A debouncer is used to eliminate the noise by waiting a short period of
     * time to ensure the user has finished the move operation.
     *
     * The "zoom" events may not occur; a simple click operation occurs as: "zoomstart" -> "zoomend". There is
     * additional logic for other corner cases, such as spurious drags which move the globe just a few pixels
     * (most likely unintentional), and the tendency for some touch devices to issue events out of order:
     * "zoom" -> "zoomstart" -> "zoomend".
     *
     * This object emits clean "moveStart" -> ("move")* -> "moveEnd" events for move operations, and "click" events
     * for normal clicks. Spurious moves emit no events.
     */
    function buildInputController() {
        var globe, op = null;

        /**
         * @returns {Object} an object to represent the state for one move operation.
         */
        function newOp(startMouse, startScale) {
            return {
                type: "click",  // initially assumed to be a click operation
                startMouse: startMouse,
                startScale: startScale,
                manipulator: globe.manipulator(startMouse, startScale)
            };
        }

        var zoom = d3.behavior.zoom()
            .on("zoomstart", function () {
                op = op || newOp(d3.mouse(this), zoom.scale());  // a new operation begins
            })
            .on("zoom", function () {
                var currentMouse = d3.mouse(this), currentScale = d3.event.scale;
                op = op || newOp(currentMouse, 1);  // Fix bug on some browsers where zoomstart fires out of order.
                if (op.type === "click") {
                    var distanceMoved = µ.distance(currentMouse, op.startMouse);
                    if (currentScale === op.startScale && (distanceMoved < MIN_MOVE || isNaN(distanceMoved))) {
                        // to reduce annoyance, ignore op if mouse has barely moved and no zoom is occurring
                        return;
                    }
                    dispatch.trigger("moveStart");
                    op.type = "drag";
                }
                if (currentScale !== op.startScale) {
                    op.type = "zoom";  // whenever a scale change is detected, (stickily) switch to a zoom operation
                }

                // when zooming, ignore whatever the mouse is doing--really cleans up behavior on touch devices
                op.manipulator.move(op.type === "zoom" ? null : currentMouse, currentScale);
                dispatch.trigger("move");
            })
            .on("zoomend", function () {
                op.manipulator.end();
                if (op.type === "click") {
                    dispatch.trigger("click", op.startMouse, globe.projection.invert(op.startMouse) || []);
                }
                else if (op.type !== "spurious") {
                    signalEnd();
                }
                op = null;  // the drag/zoom/click operation is over
            });

        var signalEnd = _.debounce(function () {
            if (!op || op.type !== "drag" && op.type !== "zoom") {
                configuration.save({ orientation: globe.orientation() }, { source: "moveEnd" });
                dispatch.trigger("moveEnd");
            }
        }, MOVE_END_WAIT);  // wait for a bit to decide if user has stopped moving the globe

        d3.select("#display").call(zoom);

        function reorient() {
            var options = arguments[3] || {};
            if (!globe || options.source === "moveEnd") {
                // reorientation occurred because the user just finished a move operation, so globe is already
                // oriented correctly.
                return;
            }
            dispatch.trigger("moveStart");
            globe.orientation(configuration.get("orientation"), view);
            zoom.scale(globe.projection.scale());
            dispatch.trigger("moveEnd");
        }

        var dispatch = _.extend({
            globe: function (_) {
                if (_) {
                    globe = _;
                    zoom.scaleExtent(globe.scaleExtent());
                    reorient();
                }
                return _ ? this : globe;
            }
        }, Backbone.Events);
        return dispatch.listenTo(configuration, "change:orientation", reorient);
    }

    /**
     * @param resource the GeoJSON resource's URL
     * @returns {Object} a promise for GeoJSON topology features: {boundaryLo:, boundaryHi:}
     */
    function buildMesh(resource) {
        var cancel = this.cancel;
        //report.status("Downloading...");
        //return µ.loadJson(resource).then(function (topo) {
        return when.map(resource, µ.loadJson).then(function (topoArr) {
            var topo = topoArr[0];
            if (cancel.requested) return null;
            log.time("building meshes");
            var o = topo.objects;
            var coastLo = topojson.feature(topo, µ.isMobile() ? o.coastline_tiny : o.coastline_110m);
            var coastHi = topojson.feature(topo, µ.isMobile() ? o.coastline_110m : o.coastline_50m);
            var lakesLo = topojson.feature(topo, µ.isMobile() ? o.lakes_tiny : o.lakes_110m);
            var lakesHi = topojson.feature(topo, µ.isMobile() ? o.lakes_110m : o.lakes_50m);
            var riversLo = topojson.feature(topo, µ.isMobile() ? o.rivers_tiny : o.rivers_110m);
            var riversHi = topojson.feature(topo, µ.isMobile() ? o.rivers_110m : o.rivers_50m);
            var twnTopo = topoArr[1];
            var twno = twnTopo.objects;
            var twnLo = topojson.feature(twnTopo, twno.twn_110m);
            var twnHi = topojson.feature(twnTopo,  twno.twn_50m);
            var locationTopo = topoArr[2];
            var location = topojson.feature(locationTopo,locationTopo.objects.places);
            log.timeEnd("building meshes");
            return {
                coastLo: coastLo,
                coastHi: coastHi,
                lakesLo: lakesLo,
                lakesHi: lakesHi,
                riversLo: riversLo,
                riversHi: riversHi,
                location: location,
                twnLo: twnLo,
                twnHi: twnHi
            };
        });
    }

    /**
     * @param {String} projectionName the desired projection's name.
     * @returns {Object} a promise for a globe object.
     */
    function buildGlobe(projectionName) {
        var builder = globes.get(projectionName);
        if (!builder) {
            return when.reject("Unknown projection: " + projectionName);
        }
        return when(builder(view));
    }

    // Some hacky stuff to ensure only one download can be in progress at a time.
    var downloadsInProgress = 0;

    function buildGrids() {
        //report.status("Downloading...");
        log.time("build grids");
        isChangeData = true;
        // UNDONE: upon failure to load a product, the unloaded product should still be stored in the agent.
        //         this allows us to use the product for navigation and other state.
        var cancel = this.cancel;
        downloadsInProgress++;
        var loaded = when.map(products.productsFor(configuration.attributes), function (product) {
            return product.load(cancel);
        });
        return when.all(loaded).then(function (products) {
            log.timeEnd("build grids");
            return { primaryGrid: products[0], overlayGrid: products[1] || products[0] };
        }).ensure(function () {
            downloadsInProgress--;
        });
    }

    function buildRenderer(mesh, globe) {
        if (!mesh || !globe) return null;

        report.status("Rendering Globe...");
        log.time("rendering map");

        // UNDONE: better way to do the following?
        var dispatch = _.clone(Backbone.Events);
        if (rendererAgent._previous) {
            rendererAgent._previous.stopListening();
        }
        rendererAgent._previous = dispatch;

        // First clear map and foreground svg contents.
        µ.removeChildren(d3.select("#map").node());
        µ.removeChildren(d3.select("#foreground").node());
        // Create new map svg elements.
        globe.defineMap(d3.select("#map"), d3.select("#foreground"), d3.select('#sea-mask'));

        var path = d3.geo.path().projection(globe.projection).pointRadius(3);
        var coastline = d3.selectAll(".coastline");
        var lakes = d3.select(".lakes");
        var rivers = d3.select(".rivers");
        var twn = d3.selectAll(".twn");
        var location = d3.select(".location");
        var locationLabels = d3.select(".location-labels");
        d3.selectAll("path").attr("d", path);  // do an initial draw -- fixes issue with safari

        function drawLocationMark(point, coord) {
            // show the location on the map if defined
            if (fieldAgent.value() && !fieldAgent.value().isInsideBoundary(point[0], point[1])) {
                // UNDONE: Sometimes this is invoked on an old, released field, because new one has not been
                //         built yet, causing the mark to not get drawn.
                return;  // outside the field boundary, so ignore.
            }
            if (coord && _.isFinite(coord[0]) && _.isFinite(coord[1])) {
                var mark = d3.select(".location-mark");
                if (!mark.node()) {
                    mark = d3.select("#foreground").append("path").attr("class", "location-mark");
                }
                mark.datum({ type: "Point", coordinates: coord }).attr("d", path);
            }
        }

        // Draw the location mark if one is currently visible.
        if (activeLocation.point && activeLocation.coord) {
            drawLocationMark(activeLocation.point, activeLocation.coord);
        }

        // Throttled draw method helps with slow devices that would get overwhelmed by too many redraw events.
        var REDRAW_WAIT = 5;  // milliseconds
        var doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, { leading: false });

        function doDraw() {
            d3.selectAll("path").attr("d", path);
            rendererAgent.trigger("redraw");
            doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, { leading: false });
        }

        // Attach to map rendering events on input controller.
        dispatch.listenTo(
            inputController, {
                moveStart: function () {
                    coastline.datum(mesh.coastLo);
                    lakes.datum(mesh.lakesLo);
                    rivers.datum(mesh.riversLo);
                    twn.datum(mesh.twnLo);
                    location.datum(mesh.location);
                    locationLabels.selectAll(".location-label").remove();
                    rendererAgent.trigger("start");
                },
                move: function () {
                    doDraw_throttled();
                },
                moveEnd: function () {
                    coastline.datum(mesh.coastHi);
                    lakes.datum(mesh.lakesHi);
                    rivers.datum(mesh.riversHi);
                    twn.datum(mesh.twnHi);
                    location.datum(mesh.location);
                    locationLabels.selectAll(".location-label").remove();
                    locationLabels.selectAll(".location-label")
                        .data(mesh.location.features)
                        .enter().append("text")
                        .attr("class", "location-label")
                        .attr("transform", function (d) { return "translate(" + globe.projection(d.geometry.coordinates) + ")"; })
                        .attr("dy", ".35em")
                        .text(function (d) { return d.properties.name; });
                    locationLabels.selectAll(".location-label")
                        .attr("x", function (d) { return d.geometry.coordinates[0] > -1 ? 6 : -6; })
                        .style("text-anchor", function (d) { return d.geometry.coordinates[0] > -1 ? "start" : "end"; });
                    d3.selectAll("path").attr("d", path);
                    rendererAgent.trigger("render");
                },
                click: drawLocationMark
            });

        // Finally, inject the globe model into the input controller. Do it on the next event turn to ensure
        // renderer is fully set up before events start flowing.
        when(true).then(function () {
            inputController.globe(globe);
        });

        log.timeEnd("rendering map");
        return "ready";
    }


    function copyTypedArray(target, source) {
        // Some browsers do not support TypedArray.prototype.set, like Android.
        if (_.isFunction(target.set)) {
            target.set(source);
        } else {
            for (var i = 0; i < source.length; i++) {
                target[i] = source[i];
            }
        }
    }
    function createMask(globe) {
        if (!globe) return null;

        log.time("render mask");

        // Create a detached canvas, ask the model to define the mask polygon, then fill with an opaque color.
        var width = view.width, height = view.height;
        var canvas = d3.select(document.createElement("canvas")).attr("width", width).attr("height", height).node();
        var context = globe.defineMask(canvas.getContext("2d"));
        context.fillStyle = "rgba(0, 0, 0, 0.1)";
        context.fill();
        // d3.select("#display").node().appendChild(canvas);  // make mask visible for debugging

        var imageData = context.createImageData(width, height);
        var data = imageData.data;  // layout: [r, g, b, a, r, g, b, a, ...]
        copyTypedArray(data, context.getImageData(0, 0, width, height).data);
        log.timeEnd("render mask");
        return {
            imageData: imageData,
            isVisible: function (x, y) {
                var i = (y * width + x) * 4;
                return data[i + 3] > 0;  // non-zero alpha means pixel is visible
            },
            set: function (x, y, rgba) {
                var i = (y * width + x) * 4;
                data[i] = rgba[0];
                data[i + 1] = rgba[1];
                data[i + 2] = rgba[2];
                data[i + 3] = rgba[3];
                return this;
            }
        };
    }

    function createField(columns, bounds, mask) {

        /**
         * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
         *          is undefined at that point.
         */
        function field(x, y) {
            var column = columns[Math.round(x)];
            return column && column[Math.round(y)] || NULL_WIND_VECTOR;
        }

        /**
         * @returns {boolean} true if the field is valid at the point (x, y)
         */
        field.isDefined = function (x, y) {
            return field(x, y)[2] !== null;
        };

        /**
         * @returns {boolean} true if the point (x, y) lies inside the outer boundary of the vector field, even if
         *          the vector field has a hole (is undefined) at that point, such as at an island in a field of
         *          ocean currents.
         */
        field.isInsideBoundary = function (x, y) {
            return field(x, y) !== NULL_WIND_VECTOR;
        };

        // Frees the massive "columns" array for GC. Without this, the array is leaked (in Chrome) each time a new
        // field is interpolated because the field closure's context is leaked, for reasons that defy explanation.
        field.release = function () {
            columns = [];
        };

        field.randomize = function (o) {  // UNDONE: this method is terrible
            var x, y;
            var safetyNet = 0;
            do {
                x = Math.round(_.random(bounds.x, bounds.xMax));
                y = Math.round(_.random(bounds.y, bounds.yMax));
            } while (!field.isDefined(x, y) && safetyNet++ < 30);
            o.x = x;
            o.y = y;
            return o;
        };

        field.overlay = mask.imageData;

        return field;
    }

    /**
     * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
     * vector is modified in place and returned by this function.
     */
    function distort(projection, λ, φ, x, y, scale, wind) {
        var u = wind[0] * scale;
        var v = wind[1] * scale;
        var d = µ.distortion(projection, λ, φ, x, y);

        // Scale distortion vectors by u and v, then add.
        wind[0] = d[0] * u + d[2] * v;
        wind[1] = d[1] * u + d[3] * v;
        return wind;
    }

    function interpolateField(globe, grids) {
        if (!globe || !grids || !meshAgent.value()) return null;
        var mask = createMask(globe);
        var primaryGrid = grids.primaryGrid;
        var overlayGrid = grids.overlayGrid;

        log.time("interpolating field");
        var d = when.defer(), cancel = this.cancel;

        var projection = globe.projection;
        var bounds = globe.bounds(view);
        // How fast particles move on the screen (arbitrary value chosen for aesthetics).
        var velocityScale = bounds.height * primaryGrid.particles.velocityScale;

        var columns = [];
        var point = [];
        var x = bounds.x;
        var interpolate = primaryGrid.interpolate;
        var overlayInterpolate = overlayGrid.interpolate;
        var hasDistinctOverlay = primaryGrid !== overlayGrid;
        var scale = overlayGrid.scale;
        var hd = false;
        var sd = true;
        var step = hd ? 1 : (sd ? 4 : 2);

        function interpolateColumn(x) {
            var column = [];
            var lastColumn = x === bounds.xMax;
            for (var y = bounds.y; y <= bounds.yMax; y = y + step) {
                var lastRow = y === bounds.yMax;
                var wind = NULL_WIND_VECTOR;
                if (mask.isVisible(x, y)) {
                    point[0] = x; point[1] = y;
                    var coord = projection.invert(point);
                    var color = TRANSPARENT_BLACK;
                    // var wind = null;
                    if (coord) {
                        var λ = coord[0], φ = coord[1];
                        if (isFinite(λ)) {
                            wind = interpolate(λ, φ);
                            var scalar = null;
                            if (wind) {
                                wind = distort(projection, λ, φ, x, y, velocityScale, wind);
                                scalar = wind[2];
                            }
                            if (hasDistinctOverlay) {
                                scalar = overlayInterpolate(λ, φ);
                            }
                            if (µ.isValue(scalar)) {
                                color = scale.gradient(scalar, OVERLAY_ALPHA);
                            }
                        }
                    }
                    mask.set(x, y, color);
                    if (!hd) {
                        mask.set(x, y + 1, color)
                            .set(x + 1, y, color)
                            .set(x + 1, y + 1, color);
                        if (sd) {
                            mask.set(x + 2, y, color)
                                .set(x + 2, y + 1, color)
                                .set(x, y + 2, color)
                                .set(x + 1, y + 2, color)
                                .set(x + 2, y + 2, color)
                                .set(x + 3, y, color)
                                .set(x + 3, y + 1, color)
                                .set(x + 3, y + 2, color)
                                .set(x, y + 3, color)
                                .set(x + 1, y + 3, color)
                                .set(x + 2, y + 3, color)
                                .set(x + 3, y + 3, color);
                        }
                    }
                }
                column[y] = wind;
                if (!hd) {
                    column[y + 1] = wind;
                    if (sd) {
                        column[y + 2] = wind;
                        column[y + 3] = wind;
                    }
                }
            }
            columns[x] = column;
            if (!hd) {
                columns[x + 1] = column;
                if (sd) {
                    columns[x + 2] = column;
                    columns[x + 3] = column;
                }
            }
        }

        report.status("");

        (function batchInterpolate() {
            try {
                if (!cancel.requested) {
                    var start = Date.now();
                    while (x < bounds.xMax) {
                        interpolateColumn(x);
                        x = x + step;
                        if ((Date.now() - start) > MAX_TASK_TIME) {
                            // Interpolation is taking too long. Schedule the next batch for later and yield.
                            report.progress((x - bounds.x) / (bounds.xMax - bounds.x));
                            setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                            return;
                        }
                    }
                }
                d.resolve(createField(columns, bounds, mask));
            }
            catch (e) {
                d.reject(e);
            }
            report.progress(1);  // 100% complete
            log.timeEnd("interpolating field");
        })();

        return d.promise;
    }

    var particles = [];
    function animate(globe, field, grids) {
        if (!globe || !field || !grids) return;
        particles = [];
        var config = configuration.get("orientation");
        var zoom = µ.isValue(config.split(',')[2]) ? config.split(',')[2] : 1000;
        var cancel = this.cancel;
        var bounds = globe.bounds(view);
        // maxIntensity is the velocity at which particle color intensity is maximum
        var colorStyles = µ.windIntensityColorScale(INTENSITY_SCALE_STEP, grids.primaryGrid.particles.maxIntensity);
        var buckets = colorStyles.map(function () { return []; });
        var particleCount = Math.round(bounds.width * PARTICLE_MULTIPLIER * 1000 / zoom);
        var scale = globe.projection.scale();
        if (µ.isMobile()) {
            particleCount *= PARTICLE_REDUCTION;
        }
        //var fadeFillStyle = µ.isFF() ? "rgba(0, 0, 0, 0.95)" : "rgba(0, 0, 0, 0.97)";  // FF Mac alpha behaves oddly
        var evolve, maxAge, fadeFillStyle;
        maxAge = 100;

        if(grids.primaryGrid.particles.waves){
            maxAge = 40;
            particleCount *= 0.5;
            evolve = evolveWaves;
            fadeFillStyle = "rgba(0, 0, 0, 0.8)";
        } else{
            evolve = evolveParticles;
            fadeFillStyle = µ.isFF() ? "rgba(0, 0, 0, 0.75)" : "rgba(0, 0, 0, 0.77)";  // FF Mac alpha behaves oddly
        }

        log.debug("particle count: " + particleCount);
        for (var i = particles.length - 1; i < particleCount; i++) {
            particles.push(field.randomize({ age: _.random(0, maxAge) }));
        }

        function evolveWaves() {
            var adj = 600 / scale * Math.pow(Math.log(scale) / Math.log(600), 2.5); // use shallower exponential speed scale
            buckets.forEach(function (bucket) { bucket.length = 0; });
            particles.forEach(function (particle) {
                if (particle.age > maxAge) {
                    field.randomize(particle).age = 0;
                }
                var x = particle.x;
                var y = particle.y;
                var v = field(x, y);  // vector at current position
                var m = v[2];
                if (m === null) {
                    particle.age = maxAge;  // particle has escaped the grid, never to return...
                }
                else {
                    var dx = v[0]
                    var dy = v[1]
                    var m = v[2]
                    var xt = x + dx * adj;
                    var yt = y + dy * adj;
                    // var xt = x + v[0];
                    // var yt = y + v[1];
                    if (field.isDefined(xt, yt)) {
                        // width of wave
                        var mag = Math.sqrt(dx * dx + dy * dy) / 2.5; // CONSIDER: would be nice to retain unscaled m...
                        dx /= mag;
                        dy /= mag;

                        particle.sx = x - dy;
                        particle.sy = y + dx;
                        particle.ex = x + dy;
                        particle.ey = y - dx;

                        buckets[colorStyles.indexFor(m)].push(particle);
                    }
                    particle.x = xt;
                    particle.y = yt;
                }
                particle.age += 1;
            });
        }

        function evolveParticles() {
            buckets.forEach(function (bucket) { bucket.length = 0; });
            particles.forEach(function (particle) {
                if (particle.age > maxAge) {
                    field.randomize(particle).age = 0;
                }
                var x = particle.x;
                var y = particle.y;
                var v = field(x, y);  // vector at current position
                var m = v[2];
                if (m === null) {
                    particle.age = maxAge;  // particle has escaped the grid, never to return...
                }
                else {
                    var xt = x + v[0];
                    var yt = y + v[1];
                    if (field.isDefined(xt, yt)) {
                        particle.sx = x;
                        particle.sy = y;
                        particle.ex = xt;
                        particle.ey = yt;

                        buckets[colorStyles.indexFor(m)].push(particle);
                    }
                    particle.x = xt;
                    particle.y = yt;
                }
                particle.age += 1;
            });
        }

        var g = d3.select("#animation").node().getContext("2d");
        g.lineWidth = PARTICLE_LINE_WIDTH;
        g.fillStyle = fadeFillStyle;
        function draw() {
            // Fade existing particle trails.
            var prev = g.globalCompositeOperation;
            g.globalCompositeOperation = "destination-in";
            g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            g.globalCompositeOperation = prev;
            // Draw new particle trails.
            buckets.forEach(function (bucket, i) {
                if (bucket.length > 0) {
                    g.beginPath();
                    g.strokeStyle = 'rgb(255, 255, 255)';
                    bucket.forEach(function (particle) {
                        g.moveTo(particle.sx, particle.sy);
                        g.lineTo(particle.ex, particle.ey);
                        // particle.x = particle.xt;
                        // particle.y = particle.yt;
                    });
                    g.stroke();
                }
            });
        }

        var lastFrameTimestamp = 0;
        var interval = 1000 / 25;
        // (function frame() {
        //     try {
        //         if (cancel.requested) {
        //             field.release();
        //             return;
        //         }
        //         evolve();
        //         draw();
        //         setTimeout(frame, FRAME_RATE);
        //     }
        //     catch (e) {
        //         report.error(e);
        //     }
        // })();
        function frame(timestamp) {
            try {
                requestAnimationFrame(frame);
                if (cancel.requested) {
                    field.release();
                    return;
                }
                if (lastFrameTimestamp === 0 || (timestamp - lastFrameTimestamp) > interval) {
                    evolve();
                    draw();
                    lastFrameTimestamp = timestamp;
                }
            }
            catch (e) {
                report.error(e);
            }
        }
        requestAnimationFrame(frame);
    }

    function drawGridPoints(ctx, grid, globe) {
        if (!grid || !globe || !configuration.get("showGridPoints")) return;
        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        // Use the clipping behavior of a projection stream to quickly draw visible points.
        var stream = globe.projection.stream({
            point: function (x, y) {
                ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
            }
        });
        grid.forEachPoint(function (λ, φ, d) {
            if (µ.isValue(d)) {
                stream.point(λ, φ);
            }
        });
    }

    function drawOverlay(field, overlayType) {
        if (!field) return;
        var drawOverlayOne = (!isChangeData) ^ d3.select("#overlay").classed("invisible");
        var ctx = drawOverlayOne ? d3.select("#overlay").node().getContext("2d") : d3.select("#overlay2").node().getContext("2d"),
            grid = (gridAgent.value() || {}).overlayGrid;
        µ.clearCanvas(d3.select("#scale").node());
        if (overlayType) {
            if (overlayType !== "off") {
                ctx.putImageData(field.overlay, 0, 0);
            }
            drawGridPoints(ctx, grid, globeAgent.value());
            if (isChangeData) {
                d3.select("#overlay").classed("invisible", !drawOverlayOne);
                d3.select("#overlay2").classed("invisible", drawOverlayOne);
                isChangeData = false;
            }
        }
        if (grid) {
            // Draw color bar for reference.
            var colorBar = d3.select("#scale"), scale = grid.scale, bounds = scale.bounds;
            var c = colorBar.node(), g = c.getContext("2d"), n = c.width - 1;
            for (var i = 0; i <= n; i++) {
                var rgb = scale.gradient(µ.spread(i / n, bounds[0], bounds[1]), 1);
                g.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
                g.fillRect(i, 0, 1, c.height);
            }
            drawColorBar(grid);
            // Show tooltip on hover.
            colorBar.on("mousemove", function () {
                var x = d3.mouse(this)[0];
                var pct = µ.clamp((Math.round(x) - 2) / (n - 2), 0, 1);
                var value = µ.spread(pct, bounds[0], bounds[1]);
                var elementId = grid.type === "wind" ? "#location-wind-units" : "#location-value-units";
                var units = createUnitToggle(elementId, grid).value();
                colorBar.attr("title", µ.formatScalar(value, units) + " " + units.label);
            });
        }
    }

    function drawColorBar(grid) {
        var scaleRange = grid.scale.range;
        var colorBar = d3.select("#color-bar");
        colorBar.selectAll('div').remove();
        if (scaleRange === undefined) return;
        var units = colorBarUnitToggle(grid).value();
        colorBar.append("div").style("background-color", "rgba(" + scaleRange[0][1][0] + "," + scaleRange[0][1][1] + "," + scaleRange[0][1][2] + "," + scaleRange[0][1][3] + ")").html(units.label);
        scaleRange.forEach(function (r, i) {
            var valText = units.conversion(r[0]);
            if (grid.type == "taprecip") {
                if (Number(valText) >= 1000) valText = Math.round(Number(valText) / 1000) + "m";
            }
            colorBar.insert("div", ":first-child").style("background-color", "rgba(" + r[1][0] + "," + r[1][1] + "," + r[1][2] + "," + r[1][3] + ")").html(valText);
        });
    }

    function colorBarUnitToggle(product) {
        var units = product.units, size = units.length, index = unitsIndex[product.type];
        return {
            value: function () {
                return units[index];
            },
            next: function () {
                unitsIndex[product.type] = (index + 1) % size;
            }
        };
    }

    /**
     * Extract the date the grids are valid, or the current date if no grid is available.
     * UNDONE: if the grids hold unloaded products, then the date can be extracted from them.
     *         This function would simplify nicely.
     */
    function validityDate(grids) {
        // When the active layer is considered "current", use its time as now, otherwise use current time as
        // now (but rounded down to the nearest three-hour block).
        var THREE_HOURS = 3 * HOUR;
        var now = grids ? grids.primaryGrid.date.getTime() : Math.floor(Date.now() / THREE_HOURS) * THREE_HOURS;
        var parts = configuration.get("date").split("/");  // yyyy/mm/dd or "current"
        var hhmm = configuration.get("hour");
        return parts.length > 1 ?
            Date.UTC(+parts[0], parts[1] - 1, +parts[2], +hhmm.substring(0, 2)) :
            parts[0] === "current" ? now : null;
    }

    /**
     * Display the grids' types in the menu.
     */
    function showGridDetails(grids) {
        var description = "", center = "";
        if (grids) {
            var langCode = d3.select("body").attr("data-lang") || "en";
            var pd = grids.primaryGrid.description(langCode), od = grids.overlayGrid.description(langCode);
            description = od.name + od.qualifier;
            if (grids.primaryGrid !== grids.overlayGrid) {
                // Combine both grid descriptions together with a " + " if their qualifiers are the same.
                description = (pd.qualifier === od.qualifier ? pd.name : pd.name + pd.qualifier) + " + " + description;
            }
            center = grids.overlayGrid.source;
        }
    }

    /**
     * Constructs a toggler for the specified product's units, storing the toggle state on the element having
     * the specified id. For example, given a product having units ["m/s", "mph"], the object returned by this
     * method sets the element's "data-index" attribute to 0 for m/s and 1 for mph. Calling value() returns the
     * currently active units object. Calling next() increments the index.
     */
    function createUnitToggle(id, product) {
        var units = product.units, size = units.length;
        var index = +(d3.select(id).attr("data-index") || 0) % size;
        return {
            value: function () {
                return units[index];
            },
            next: function () {
                d3.select(id).attr("data-index", index = ((index + 1) % size));
            }
        };
    }

    /**
     * Display the specified wind value. Allow toggling between the different types of wind units.
     */
    function showWindAtLocation(wind, product) {
        //var unitToggle = createUnitToggle("#location-wind-units", product), units = unitToggle.value();
        var unitToggle = colorBarUnitToggle(product), units = unitToggle.value();
        d3.select("#location-wind").text(µ.formatVector(wind, units));
        d3.select("#location-wind-units").text(units.label);
        //d3.select("#location-wind-units").text(units.label).on("click", function () {
        //    unitToggle.next();
        //    showWindAtLocation(wind, product);
        //    drawColorBar(product);
        //});
    }

    /**
     * Display the specified overlay value. Allow toggling between the different types of supported units.
     */
    function showOverlayValueAtLocation(value, product) {
        //var unitToggle = createUnitToggle("#location-value-units", product), units = unitToggle.value();
        var unitToggle = colorBarUnitToggle(product), units = unitToggle.value();
        d3.select("#location-value").text(µ.formatScalar(value, units));
        d3.select("#location-value-units").text(units.label);
        //d3.select("#location-value-units").text(units.label).on("click", function () {
        //    unitToggle.next();
        //    showOverlayValueAtLocation(value, product);
        //    drawColorBar(product);
        //});
    }

    // Stores the point and coordinate of the currently visible location. This is used to update the location
    // details when the field changes.
    var activeLocation = {};

    /**
     * Display a local data callout at the given [x, y] point and its corresponding [lon, lat] coordinates.
     * The location may not be valid, in which case no callout is displayed. Display location data for both
     * the primary grid and overlay grid, performing interpolation when necessary.
     */
    function showLocationDetails(point, coord) {
        point = point || [];
        coord = coord || [];
        var grids = gridAgent.value(), field = fieldAgent.value(), λ = coord[0], φ = coord[1];
        if (!field || !field.isInsideBoundary(point[0], point[1])) {
            return;
        }

        clearLocationDetails(false);  // clean the slate
        activeLocation = { point: point, coord: coord };  // remember where the current location is

        if (_.isFinite(λ) && _.isFinite(φ)) {
            d3.select("#location-coord").text(µ.formatCoordinates(λ, φ));
            d3.select("#location-close").classed("invisible", false);
        }

        if (field.isDefined(point[0], point[1]) && grids) {
            var wind = grids.primaryGrid.interpolate(λ, φ);
            if (µ.isValue(wind)) {
                showWindAtLocation(wind, grids.primaryGrid);
            }
            if (grids.overlayGrid !== grids.primaryGrid) {
                var value = grids.overlayGrid.interpolate(λ, φ);
                showOverlayValueAtLocation(value, grids.overlayGrid);
            }
        }
    }

    function updateLocationDetails() {
        showLocationDetails(activeLocation.point, activeLocation.coord);
    }

    function clearLocationDetails(clearEverything) {
        d3.select("#location-coord").text("");
        d3.select("#location-close").classed("invisible", true);
        d3.select("#location-wind").text("");
        d3.select("#location-wind-units").text("");
        d3.select("#location-value").text("");
        d3.select("#location-value-units").text("");
        if (clearEverything) {
            activeLocation = {};
            d3.select(".location-mark").remove();
        }
    }

    function stopCurrentAnimation(alsoClearCanvas) {
        animatorAgent.cancel();
        if (alsoClearCanvas) {
            particles = [];
            µ.clearCanvas(d3.select("#animation").node());
        }
    }

    /**
     * Registers a click event handler for the specified DOM element which modifies the configuration to have
     * the attributes represented by newAttr. An event listener is also registered for configuration change events,
     * so when a change occurs the button becomes highlighted (i.e., class ".highlighted" is assigned or removed) if
     * the configuration matches the attributes for this button. The set of attributes used for the matching is taken
     * from newAttr, unless a custom set of keys is provided.
     */
    function bindButtonToConfiguration(elementId, newAttr, keys) {
        keys = keys || _.keys(newAttr);
        d3.select(elementId).on("click", function () {
            if (d3.select(elementId).classed("disabled")) return;
            configuration.save(newAttr);
        });
        configuration.on("change", function (model) {
            var attr = model.attributes;
            d3.select(elementId).classed("highlighted", _.isEqual(_.pick(attr, keys), _.pick(newAttr, keys)));
        });
    }

    function createTimeline(minifest) {
        var bottomCtrl = document.getElementById("bottom");
        bottomCtrl.onclick = function (a) {
            var c = a.target,
                d = c.dataset.name,
                e = c.dataset.value;
            if (d) {
                switch (d) {
                    case "barIndex": timelineBarCtrl.setIndex(e); break;
                    case "play": barCtrl.toggle(); break;
                } a.preventDefault()
            }
        };
        var barCtrl = {
            isRunning: !1,
            semaphore: !1,
            timer: null,
            button: document.getElementById("playpause"),
            buttonMobile: document.getElementById("playpause-mobile"),
            pbWrapper: document.getElementById("timeline-bar-wrapper"),
            start: function () {
                this.isRunning = !0,
                    this.button.className = "pause",
                    this.buttonMobile.className = "pause",
                    this.pbWrapper.className = "onanimation",
                    this.run();
            }, stop: function () {
                this.semaphore = !1,
                    this.isRunning = !1,
                    this.button.className = "play",
                    this.buttonMobile.className = "play",
                    this.pbWrapper.className = "",
                    clearTimeout(this.timer)
            }, toggle: function () {
                this.isRunning ? this.stop() : this.start()
            }, run: function () {
                var b = timelineBarCtrl.getIndex();
                b >= calendarCtrl.maxIndex ? (b = 0, timelineBarCtrl.setIndex(b, !0)) : (this.semaphore || (b += 30e-5, timelineBarCtrl.setIndex(b, !0)))
                void (this.timer = setTimeout(this.run.bind(this), 50));
            }
        };

        timelineBarCtrl.on("change:barIndex", function (t, i) {
            var p = calendarCtrl.index2path(i);
            d3.select("#calendar-select").property("value", p);
            calendarCtrl.set({ datePath: p });
        });
        calendarCtrl.on("change:datePath", function (c, p) {
            configuration.save(µ.dateToConfig(calendarCtrl.path2date(p)));
        });
        d3.select("#calendar-select").on("change", function () {
            var i = calendarCtrl.path2index(this.value);
            timelineBarCtrl.setIndex(i);
        });
        var firstTime = minifest.data[0];
        var startTime = new Date();
        startTime.setUTCMonth(Number(firstTime.substr(0, 2)) - 1);
        startTime.setUTCDate(firstTime.substr(2, 2));
        startTime.setUTCHours(firstTime.substr(4));
        startTime = startTime.toHourTime();
        calendarCtrl.init({ minifest: minifest, startOfTimeline: startTime });
        timelineBarCtrl.init(calendarCtrl);
    }

    var unitsIndex = {};
    /**
     * Registers all event handlers to bind components and page elements together. There must be a cleaner
     * way to accomplish this...
     */
    function init() {
        report.status("Initializing...");

        d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
        // Adjust size of the scale canvas to fill the width of the menu to the right of the label.
        var label = d3.select("#scale-label").node();
        d3.select("#scale")
            .attr("width", (d3.select("#select-list").node().offsetWidth - label.offsetWidth) * 0.97)
            .attr("height", label.offsetHeight / 2);

        d3.select("#show-menu").on("click", function () {
            if (µ.isEmbeddedInIFrame()) {
                window.open("http://earth.nullschool.net/" + window.location.hash, "_blank");
            }
            else {
                d3.select("#select-list").classed("invisible", !d3.select("#select-list").classed("invisible"));
            }
        });

        if (µ.isFF()) {
            // Workaround FF performance issue of slow click behavior on map having thick coastlines.
            d3.select("#display").classed("firefox", true);
        }

        // Tweak document to distinguish CSS styling between touch and non-touch environments. Hacky hack.
        if ("ontouchstart" in document.documentElement) {
            d3.select(document).on("touchstart", function () { });  // this hack enables :active pseudoclass
        }
        else {
            d3.select(document.documentElement).classed("no-touch", true);  // to filter styles problematic for touch
        }

        // Bind configuration to URL bar changes.
        d3.select(window).on("hashchange", function () {
            configuration.fetch({ trigger: "hashchange" });
        });

        configuration.on("change", report.reset);

        meshAgent.listenTo(configuration, "change:topology", function (context, attr) {
            meshAgent.submit(buildMesh, attr);
        });

        globeAgent.listenTo(configuration, "change:projection", function (source, attr) {
            globeAgent.submit(buildGlobe, attr);
        });

        gridAgent.listenTo(configuration, "change", function () {
            var changed = _.keys(configuration.changedAttributes()), rebuildRequired = false;

            // Build a new grid if any layer-related attributes have changed.
            if (_.intersection(changed, ["date", "hour", "param", "surface", "level"]).length > 0) {
                rebuildRequired = true;
            }
            // Build a new grid if the new overlay type is different from the current one.
            var overlayType = configuration.get("overlayType") || "default";
            if (_.indexOf(changed, "overlayType") >= 0 && overlayType !== "off") {
                var grids = (gridAgent.value() || {}), primary = grids.primaryGrid, overlay = grids.overlayGrid;
                if (!overlay) {
                    // Do a rebuild if we have no overlay grid.
                    rebuildRequired = true;
                }
                else if (overlay.type !== overlayType && !(overlayType === "default" && primary === overlay)) {
                    // Do a rebuild if the types are different.
                    rebuildRequired = true;
                }
            }
            if (rebuildRequired) {
                gridAgent.submit(buildGrids);
            }
        });
        gridAgent.on("submit", function () {
            showGridDetails(null);
        });
        gridAgent.on("update", function (grids) {
            showGridDetails(grids);
        });

        function startRendering() {
            rendererAgent.submit(buildRenderer, meshAgent.value(), globeAgent.value());
        }
        rendererAgent.listenTo(meshAgent, "update", startRendering);
        rendererAgent.listenTo(globeAgent, "update", startRendering);

        function startInterpolation() {
            fieldAgent.submit(interpolateField, globeAgent.value(), gridAgent.value());
        }
        function cancelInterpolation() {
            fieldAgent.cancel();
        }
        fieldAgent.listenTo(gridAgent, "update", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "render", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "start", cancelInterpolation);
        fieldAgent.listenTo(rendererAgent, "redraw", cancelInterpolation);

        animatorAgent.listenTo(fieldAgent, "update", function (field) {
            animatorAgent.submit(animate, globeAgent.value(), field, gridAgent.value());
        });
        animatorAgent.listenTo(rendererAgent, "start", stopCurrentAnimation.bind(null, true));
        animatorAgent.listenTo(gridAgent, "submit", stopCurrentAnimation.bind(null, false));
        animatorAgent.listenTo(fieldAgent, "submit", stopCurrentAnimation.bind(null, false));

        overlayAgent.listenTo(fieldAgent, "update", function () {
            overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
        });
        overlayAgent.listenTo(rendererAgent, "start", function () {
            µ.clearCanvas(d3.select("#overlay").node());
            µ.clearCanvas(d3.select("#overlay2").node());
            overlayAgent.submit(drawOverlay, fieldAgent.value(), null);
        });
        overlayAgent.listenTo(configuration, "change", function () {
            var changed = _.keys(configuration.changedAttributes())
            // if only overlay relevant flags have changed...
            if (_.intersection(changed, ["overlayType", "showGridPoints"]).length > 0) {
                overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
            }
        });

        // Add event handlers for showing, updating, and removing location details.
        inputController.on("click", showLocationDetails);
        fieldAgent.on("update", updateLocationDetails);
        d3.select("#location-close").on("click", _.partial(clearLocationDetails, true));


        d3.select("#color-bar").on('click', function () {
            var grids = gridAgent.value();
            if (grids.overlayGrid !== grids.primaryGrid) {
                colorBarUnitToggle(grids.overlayGrid).next();
                drawColorBar(grids.overlayGrid);
                updateLocationDetails();
            }
            else {
                colorBarUnitToggle(grids.primaryGrid).next();
                drawColorBar(grids.primaryGrid);
                updateLocationDetails();
            }
        });
        // 資料下拉選單
        d3.select("#overlay-select").on("change", function () {
            var overlay = this.value;
            if (overlay === "wind")
                configuration.save({ param: "wind", overlayType: "default" });
            else if(overlay === 'htsgw')
                configuration.save({ param: "ocean", overlayType: "htsgw" });
            else
                configuration.save({ param: "wind", overlayType: overlay });
        });
        d3.select("#level-select").on("change", function () {
            var level = this.value;
            configuration.save({ param: "wind", level: level });
        });
        d3.select("#playanime").on("click", function () {
            var isPlay = d3.select("#playanime").classed("play");
            d3.select("#playanime").classed("play", !isPlay);
            d3.select("#playanime").classed("pause", isPlay);
            d3.select("#playanime").attr("title", isPlay ? "停止動畫" : "播放動畫");
            d3.select("#animation").classed("invisible", !isPlay);
        });
        configuration.on("change:param change:overlayType", function (x, ot) {
            var overlay = configuration.get('overlayType');
            var param = configuration.get('param');
            d3.select("#overlay-select").property("value", overlay === "default" ? (param === "ocean" ? "htsgwo" : "wind") : overlay);
            var seaMaskShow = (param === "ocean" || overlay === 'htsgw')
            d3.select("#sea-mask").classed("invisible", !seaMaskShow);
        });

        configuration.on("change:level", function (x, lv) {
            d3.select("#level-select").property("value", lv);
        });

        products.overlayTypes.forEach(function (k) {
            unitsIndex[k] = 0;
        });

        // When touch device changes between portrait and landscape, rebuild globe using the new view size.
        d3.select(window).on("orientationchange", function () {
            view = µ.view();
            globeAgent.submit(buildGlobe, configuration.get("projection"));
        });

        window.addEventListener("resize", function () {
            view = µ.view();
            d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
            globeAgent.submit(buildGlobe, configuration.get("projection"));
        });

    }

    function start() {
        // Everything is now set up, so load configuration from the hash fragment and kick off change events.
        configuration.fetch();
        timelineAgent.submit(createTimeline, minifest);
    }

    function loadMinifest() {
        return µ.loadJson('./data/weather/minifest.json', false).then(function (r) {
            minifest = r;
            var firstTime = minifest.data[0];
            var startTime = new Date();
            startTime.setUTCMonth(Number(firstTime.substr(0, 2)) - 1);
            startTime.setUTCDate(firstTime.substr(2, 2));
            startTime.setUTCHours(firstTime.substr(4));
            startTime = startTime.toHourTime();
            var startPath = startTime.toUTCPath();
            var config = startPath + "00Z/wind/sfc/mercator=122.05,23.75,5000";
            configuration._defaultConfig = config;
        });
    }

    if (window.location.pathname.indexOf("index.html") >= 0)
        window.location.pathname = window.location.pathname.replace("index.html", "");

    when(true).then(loadMinifest).then(init).then(start).otherwise(report.error);

})();
