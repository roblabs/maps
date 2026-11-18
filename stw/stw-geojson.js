// stw-geojson.js
// Copyright © 2026 ePi Rational, Inc.  All rights reserved.
// SPDX-License-Identifier: MIT

// Draws Share the World (STW) GeoJSON on a `mapkit.Map`: simplestyle colors and widths, `stroke-layer`, marker
// callouts, and the `mapshot` title, description and basemap. The rules are in stw-style.js (STWStyle).
(function (root) {
    "use strict";

    const S = root.STWStyle;

    function coordinate(position) {
        return new mapkit.Coordinate(position[1], position[0]);
    }

    function style(s) {
        return new mapkit.Style({
            strokeColor: s.stroke,
            strokeOpacity: s.strokeOpacity,
            lineWidth: s.strokeWidth,
            lineJoin: "round",
            lineCap: "round",
            fillColor: s.fill,
            fillOpacity: s.fillOpacity,
        });
    }

    // Lines and polygons as overlays. `layers[n]` holds every feature's n-th stroke layer, so a second layer is
    // above the first layer of all features, as in the app.
    function addShapes(features, layers, slot) {
        function add(index, overlay) {
            (layers[index] = layers[index] || []).push(overlay);
        }
        features.forEach(function (feature) {
            const geometry = feature.geometry;
            if (!geometry) return;
            const styles = S.overlayStyles(S.variant(feature.properties, slot));
            styles.forEach(function (s, index) {
                const mapkitStyle = style(s);
                switch (geometry.type) {
                    case "LineString":
                        add(index, new mapkit.PolylineOverlay(geometry.coordinates.map(coordinate), { style: mapkitStyle }));
                        break;
                    case "MultiLineString":
                        geometry.coordinates.forEach(function (line) {
                            add(index, new mapkit.PolylineOverlay(line.map(coordinate), { style: mapkitStyle }));
                        });
                        break;
                    case "Polygon":
                        add(index, new mapkit.PolygonOverlay(geometry.coordinates.map(function (ring) { return ring.map(coordinate); }), { style: mapkitStyle }));
                        break;
                    case "MultiPolygon":
                        geometry.coordinates.forEach(function (polygon) {
                            add(index, new mapkit.PolygonOverlay(polygon.map(function (ring) { return ring.map(coordinate); }), { style: mapkitStyle }));
                        });
                        break;
                }
            });
        });
    }

    function text(className, lines, size) {
        const element = document.createElement("div");
        element.className = className;
        element.style.fontSize = size + "px";
        lines.forEach(function (line) {
            const row = document.createElement("div");
            row.textContent = line;
            element.appendChild(row);
        });
        return element;
    }

    // The text color and halo as CSS variables; stw.css draws the halo from them.
    function setTextVariables(element, text) {
        element.style.setProperty("--stw-text", text.color);
        element.style.setProperty("--stw-halo", text.haloColor);
        element.style.setProperty("--stw-halo-width", text.haloWidth + "px");
    }

    // A point with a title and `marker-callout`: a dot, a leader line and a label with a halo.
    function calloutElement(label, color, textStyle) {
        const root = document.createElement("div");
        root.className = "stw-callout";
        setTextVariables(root, textStyle);
        root.style.setProperty("--stw-line", label.lineColor);
        root.style.setProperty("--stw-line-opacity", label.lineOpacity);
        root.style.setProperty("--stw-line-width", label.lineWidth + "px");
        root.style.setProperty("--stw-distance", label.distance + "px");
        root.style.setProperty("--stw-dot", color);
        const body = document.createElement("div");
        body.className = "stw-callout__label";
        body.style.textAlign = label.align;
        body.appendChild(text("stw-callout__title", label.title, label.titleSize));
        if (label.description.length > 0) body.appendChild(text("stw-callout__description", label.description, label.descriptionSize));
        const dot = document.createElement("div");
        dot.className = "stw-callout__dot";
        const line = document.createElement("div");
        line.className = "stw-callout__line";
        root.appendChild(body);
        root.appendChild(line);
        root.appendChild(dot);
        return root;
    }

    function addPoints(features, mapshot, items, slot) {
        const withCallouts = mapshot["marker-callout"] === true;
        features.forEach(function (feature) {
            const geometry = feature.geometry;
            if (!geometry || (geometry.type !== "Point" && geometry.type !== "MultiPoint")) return;
            const positions = geometry.type === "Point" ? [geometry.coordinates] : geometry.coordinates;
            const resolved = S.variant(feature.properties, slot);
            const properties = Object.assign({}, { "marker-size": mapshot["marker-size"] }, resolved);
            const label = S.callout(resolved, S.variant(mapshot, slot));
            const color = S.markerColor(properties);
            const textStyle = S.textStyle(feature.properties, mapshot, slot);
            positions.forEach(function (position) {
                let annotation;
                if (withCallouts && label) {
                    annotation = new mapkit.Annotation(coordinate(position), function () { return calloutElement(label, color, textStyle); }, {
                        calloutEnabled: false,
                        size: { width: 8, height: 8 },
                    });
                } else {
                    const marker = { color: color };
                    if (label) {
                        marker.title = label.title.join(" ");
                        marker.subtitle = label.description.join(" ");
                    }
                    annotation = new mapkit.MarkerAnnotation(coordinate(position), marker);
                }
                items.push(annotation);
            });
        });
    }

    // The point halfway along a line, by length, and the screen angle in degrees of the segment there, turned so the
    // text reads left to right. Longitude is scaled by cos(latitude) so the angle matches the Mercator map.
    function lineMidpoint(line) {
        const scale = Math.cos((line[0][1] * Math.PI) / 180);
        function length(a, b) { return Math.hypot((b[0] - a[0]) * scale, b[1] - a[1]); }
        let total = 0;
        for (let i = 1; i < line.length; i++) total += length(line[i - 1], line[i]);
        let remaining = total / 2;
        for (let i = 1; i < line.length; i++) {
            const segment = length(line[i - 1], line[i]);
            if (remaining <= segment || i === line.length - 1) {
                const t = segment === 0 ? 0 : Math.min(remaining / segment, 1);
                const a = line[i - 1];
                const b = line[i];
                let angle = (-Math.atan2(b[1] - a[1], (b[0] - a[0]) * scale) * 180) / Math.PI;
                if (angle > 90) angle -= 180;
                if (angle < -90) angle += 180;
                return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle: angle };
            }
            remaining -= segment;
        }
        return null;
    }

    // MapKit JS has no text along a line, so a line with `label-placement: "line"` gets its `title` as one label at the
    // middle of the line, turned to the line's direction. `label-size`, `label-color` and `label-halo-color` style it.
    function addLineLabels(features, items, slot) {
        features.forEach(function (feature) {
            const geometry = feature.geometry;
            const properties = S.variant(feature.properties, slot);
            if (!geometry || properties["label-placement"] !== "line" || typeof properties.title !== "string") return;
            const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
            const textStyle = S.textStyle({
                "text-color": properties["label-color"],
                "text-halo-color": properties["label-halo-color"],
            }, {}, slot);
            lines.forEach(function (line) {
                const middle = line.length > 1 ? lineMidpoint(line) : null;
                if (!middle) return;
                items.push(new mapkit.Annotation(coordinate(middle.position), function () {
                    const element = document.createElement("div");
                    element.className = "stw-line-label";
                    setTextVariables(element, textStyle);
                    const label = text("stw-line-label__text", [properties.title], isFinite(properties["label-size"]) ? properties["label-size"] : 16);
                    label.style.transform = "translate(-50%, -50%) rotate(" + middle.angle + "deg)";
                    element.appendChild(label);
                    return element;
                }, { calloutEnabled: false, size: { width: 8, height: 8 } }));
            });
        });
    }

    // The `mapshot` title and description as a caption, the description at 80 percent of the title.
    function addCaption(container, mapshot) {
        if (!mapshot.title && !mapshot.description) return null;
        const caption = document.createElement("div");
        caption.className = "stw-caption";
        const size = S.MARKER_SIZES.medium.label;
        if (mapshot.title) caption.appendChild(text("stw-caption__title", String(mapshot.title).split("\n"), size));
        if (mapshot.description) caption.appendChild(text("stw-caption__description", String(mapshot.description).split("\n"), Math.round(size * 0.8)));
        container.appendChild(caption);
        return caption;
    }

    // The key of `mapkit.Map.MapTypes` the map shows now.
    function mapTypeKey(map) {
        const types = mapkit.Map.MapTypes;
        const found = Object.keys(types).filter(function (key) { return types[key] === map.mapType; });
        return found.length > 0 ? found[0] : "Standard";
    }

    function prefersDark() {
        return !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches);
    }

    // Every overlay, bottom stroke layer first, then the points, for one slot.
    function buildItems(features, mapshot, slot) {
        const layers = [];
        addShapes(features, layers, slot);
        const items = [];
        layers.forEach(function (overlays) {
            overlays.forEach(function (overlay) { items.push(overlay); });
        });
        addPoints(features, mapshot, items, slot);
        addLineLabels(features, items, slot);
        return items;
    }

    // Draws `geojson` on `map`. `container` is the map's element, which gets the caption. When the system appearance
    // or the map type changes, the colors are rebuilt for the new slot and the camera stays where it is.
    function render(map, container, geojson) {
        const features = geojson.type === "FeatureCollection" ? geojson.features || [] : geojson.type === "Feature" ? [geojson] : [];
        const mapshot = geojson.mapshot || {};
        map.mapType = mapkit.Map.MapTypes[S.mapType(mapshot)];
        map.colorScheme = mapkit.Map.ColorSchemes.Adaptive;
        const search = root.location ? root.location.search : "";
        map.showsMapTypeControl = !/[?&]maptype=0(&|$)/.test(search);
        map.showsScale = /[?&]scale=0(&|$)/.test(search) ? mapkit.FeatureVisibility.Hidden : mapkit.FeatureVisibility.Visible;
        let slot = S.appearance(prefersDark(), mapTypeKey(map));
        const items = buildItems(features, mapshot, slot);
        map.showItems(items, { animate: false, padding: new mapkit.Padding(60, 60, 60, 60) });
        const caption = addCaption(container, mapshot);
        if (caption) setTextVariables(caption, S.textStyle(null, mapshot, slot));
        let current = items;
        function restyle() {
            const next = S.appearance(prefersDark(), mapTypeKey(map));
            if (next === slot) return;
            slot = next;
            map.removeItems(current);
            current = buildItems(features, mapshot, slot);
            map.addItems(current);
            if (caption) setTextVariables(caption, S.textStyle(null, mapshot, slot));
        }
        if (map.addEventListener) map.addEventListener("map-type-change", restyle);
        const query = root.matchMedia ? root.matchMedia("(prefers-color-scheme: dark)") : null;
        if (query && query.addEventListener) query.addEventListener("change", restyle);
        return items;
    }

    // Starts MapKit JS with a token read from `tokenURL` (plain text, see Scripts/make-token.py), draws the GeoJSON at
    // `geojsonURL` in `container` and resolves with the map.
    async function show(container, geojsonURL, tokenURL) {
        mapkit.init({
            authorizationCallback: function (done) {
                fetch(tokenURL).then(function (response) { return response.text(); }).then(function (token) { done(token.trim()); });
            },
        });
        const map = new mapkit.Map(container);
        const geojson = await (await fetch(geojsonURL)).json();
        render(map, container, geojson);
        return map;
    }

    root.STWGeoJSON = { render: render, show: show };
})(typeof globalThis !== "undefined" ? globalThis : this);
