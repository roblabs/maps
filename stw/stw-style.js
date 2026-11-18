// stw-style.js
// Copyright © 2026 ePi Rational, Inc.  All rights reserved.
// SPDX-License-Identifier: MIT

// The Share the World (STW) GeoJSON rules as pure functions: no DOM and no MapKit JS, so they run in a browser
// and in `jsc` (see Tests/stw-style.test.js). The Swift twins are SimpleStyle, StrokeLayers.swift and CalloutLayer.swift.
(function (root) {
    "use strict";

    const DEFAULTS = {
        stroke: "#555555",
        strokeOpacity: 1,
        strokeWidth: 2,
        fill: "#555555",
        fillOpacity: 0.6,
        markerColor: "#7e7e7e",
        markerSize: "medium",
        calloutLineColor: "#8c8c8c", // 0.55 gray
        calloutLineOpacity: 0.9,
        calloutLineWidth: 1,
        calloutDistance: 40,
        calloutAlign: "center",
        textColor: "#ffffff",
        textHaloColor: "#000000",
        textHaloWidth: 1,
    };
    const MAXIMUM_STROKE_LAYERS = 8;
    // Point size of the symbol and of the label for each `marker-size`.
    const MARKER_SIZES = {
        small: { symbol: 20, label: 12 },
        medium: { symbol: 32, label: 16 },
        large: { symbol: 44, label: 18 },
    };
    // `mapshot.basemap` to a `mapkit.Map.MapTypes` key.
    const BASEMAPS = { standard: "Standard", satellite: "Satellite", hybrid: "Hybrid", muted: "MutedStandard" };
    const SUBTITLE_SCALE = 0.8;
    const HEX = /^#[0-9a-fA-F]{6}$/;
    // Keys a slot of the `stw` object may set, each with the check a value must pass (SPEC-stw-appearance.md).
    const SLOT_KEYS = {
        stroke: isHex,
        "stroke-opacity": isUnit,
        "stroke-width": isPositive,
        "stroke-layer": Array.isArray,
        fill: isHex,
        "fill-opacity": isUnit,
        "marker-color": isHex,
        "marker-callout-color": isHex,
        "text-color": isHex,
        "text-halo-color": isHex,
        "text-halo-width": isHaloWidth,
    };
    // The slots to read for an appearance, least specific first. The base keys are the light, standard look.
    const SLOT_CHAINS = {
        base: [],
        "light-muted": ["light-muted"],
        dark: ["dark"],
        "dark-muted": ["dark", "dark-muted"],
        satellite: ["satellite"],
    };

    function isNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function isHex(value) {
        return HEX.test(value);
    }

    function isUnit(value) {
        return isNumber(value) && value >= 0 && value <= 1;
    }

    function isPositive(value) {
        return isNumber(value) && value > 0;
    }

    function isHaloWidth(value) {
        return isNumber(value) && value >= 0;
    }

    function clamp(value, low, high) {
        return Math.min(Math.max(value, low), high);
    }

    // The slot for a color scheme and a `mapkit.Map.MapTypes` key: satellite and hybrid share one slot in both schemes.
    function appearance(isDark, mapTypeKey) {
        if (mapTypeKey === "Satellite" || mapTypeKey === "Hybrid") return "satellite";
        const muted = mapTypeKey === "MutedStandard";
        if (isDark) return muted ? "dark-muted" : "dark";
        return muted ? "light-muted" : "base";
    }

    // `properties` with the keys of `properties.stw[slot]` (and the slots it falls back to) laid over the base keys.
    // A key whose value is invalid is skipped, so the base value stays. The input is not changed.
    function variant(properties, slot) {
        const p = properties || {};
        const chain = SLOT_CHAINS[slot] || [];
        const stw = p.stw && typeof p.stw === "object" ? p.stw : null;
        if (!stw || chain.length === 0) return p;
        const result = Object.assign({}, p);
        chain.forEach(function (name) {
            const values = stw[name];
            if (!values || typeof values !== "object") return;
            Object.keys(SLOT_KEYS).forEach(function (key) {
                if (values[key] !== undefined && SLOT_KEYS[key](values[key])) result[key] = values[key];
            });
        });
        return result;
    }

    // Text color and halo for a feature's label or, with null properties, the caption: the feature's value (slot, then
    // base key), then the `mapshot` value, then the default. Callers pass the base properties and the slot.
    function textStyle(properties, mapshot, slot) {
        const feature = variant(properties, slot);
        const file = variant(mapshot, slot);
        function pick(key, valid, fallback) {
            if (valid(feature[key])) return feature[key];
            if (valid(file[key])) return file[key];
            return fallback;
        }
        return {
            color: pick("text-color", isHex, DEFAULTS.textColor),
            haloColor: pick("text-halo-color", isHex, DEFAULTS.textHaloColor),
            haloWidth: clamp(pick("text-halo-width", isHaloWidth, DEFAULTS.textHaloWidth), 0, 8),
        };
    }

    // The base style of a feature, with the simplestyle-spec defaults for anything missing or malformed.
    function baseStyle(properties) {
        const p = properties || {};
        return {
            stroke: HEX.test(p.stroke) ? p.stroke : DEFAULTS.stroke,
            strokeOpacity: isNumber(p["stroke-opacity"]) ? clamp(p["stroke-opacity"], 0, 1) : DEFAULTS.strokeOpacity,
            strokeWidth: isNumber(p["stroke-width"]) && p["stroke-width"] > 0 ? p["stroke-width"] : DEFAULTS.strokeWidth,
            fill: HEX.test(p.fill) ? p.fill : DEFAULTS.fill,
            fillOpacity: isNumber(p["fill-opacity"]) ? clamp(p["fill-opacity"], 0, 1) : DEFAULTS.fillOpacity,
        };
    }

    // `stroke-layer`: a list of [color, opacity, width] with an optional fourth value, "inside". The first entry is the
    // bottom layer. Invalid entries are skipped and at most 8 are kept, like StrokeLayers.swift.
    function strokeLayers(properties) {
        const entries = properties && properties["stroke-layer"];
        if (!Array.isArray(entries)) return [];
        const layers = [];
        for (const entry of entries) {
            if (layers.length >= MAXIMUM_STROKE_LAYERS) break;
            if (!Array.isArray(entry) || (entry.length !== 3 && entry.length !== 4)) continue;
            if (entry.length === 4 && entry[3] !== "inside") continue;
            const [color, opacity, width] = entry;
            if (!HEX.test(color) || !isNumber(opacity) || opacity < 0 || opacity > 1) continue;
            if (!isNumber(width) || width <= 0) continue;
            layers.push({ stroke: color, strokeOpacity: opacity, strokeWidth: width, inside: entry.length === 4 });
        }
        return layers;
    }

    // One style per overlay to draw, bottom first. Without `stroke-layer` it is the feature's own style. With it, the
    // first layer replaces stroke, opacity and width and keeps the fill; the others have no fill.
    function overlayStyles(properties) {
        const base = baseStyle(properties);
        const layers = strokeLayers(properties);
        if (layers.length === 0) return [base];
        return layers.map(function (layer, index) {
            return Object.assign({}, base, layer, { fillOpacity: index === 0 ? base.fillOpacity : 0 });
        });
    }

    function markerSize(properties) {
        const name = properties && properties["marker-size"];
        return MARKER_SIZES[name] ? name : DEFAULTS.markerSize;
    }

    function markerColor(properties) {
        const color = properties && properties["marker-color"];
        return HEX.test(color) ? color : DEFAULTS.markerColor;
    }

    function textLines(text) {
        return typeof text === "string" && text.length > 0 ? text.split("\n") : [];
    }

    // The label of a callout: the title, then the description at 80 percent of the title's size. A description that
    // repeats the title is left out. `mapshot` holds the file's defaults for `marker-callout-*`.
    function callout(properties, mapshot) {
        const p = properties || {};
        const m = mapshot || {};
        const title = textLines(p.title);
        if (title.length === 0) return null;
        const description = p.description === p.title ? [] : textLines(p.description);
        const size = MARKER_SIZES[markerSize(Object.assign({}, { "marker-size": m["marker-size"] }, p))];
        const pick = function (key) {
            return p[key] !== undefined ? p[key] : m[key];
        };
        const color = pick("marker-callout-color");
        const opacity = pick("marker-callout-opacity");
        const width = pick("marker-callout-width");
        const distance = pick("marker-callout-distance");
        const align = pick("marker-callout-align");
        return {
            title: title,
            description: description,
            titleSize: size.label,
            descriptionSize: Math.round(size.label * SUBTITLE_SCALE),
            lineColor: HEX.test(color) ? color : DEFAULTS.calloutLineColor,
            lineOpacity: isNumber(opacity) ? clamp(opacity, 0, 1) : DEFAULTS.calloutLineOpacity,
            lineWidth: isNumber(width) ? clamp(width, 0.25, 8) : DEFAULTS.calloutLineWidth,
            distance: isNumber(distance) ? distance : DEFAULTS.calloutDistance,
            align: ["left", "center", "right"].indexOf(align) >= 0 ? align : DEFAULTS.calloutAlign,
        };
    }

    // `mapshot.basemap` as a key of `mapkit.Map.MapTypes`.
    function mapType(mapshot) {
        const name = mapshot && typeof mapshot.basemap === "string" ? mapshot.basemap.toLowerCase() : "";
        return BASEMAPS[name] || "Standard";
    }

    root.STWStyle = {
        DEFAULTS: DEFAULTS,
        MARKER_SIZES: MARKER_SIZES,
        appearance: appearance,
        variant: variant,
        textStyle: textStyle,
        baseStyle: baseStyle,
        strokeLayers: strokeLayers,
        overlayStyles: overlayStyles,
        markerSize: markerSize,
        markerColor: markerColor,
        callout: callout,
        mapType: mapType,
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
