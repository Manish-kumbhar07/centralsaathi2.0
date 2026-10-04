# Maps JavaScript API: Add a Basic Map

This skill provides the steps necessary to add a functional, interactive Google
Map to a web page using the Maps JavaScript API. There are two primary methods:
using the declarative `<gmp-map>` Web Component or the traditional imperative
`new google.maps.Map()` approach.

## 1. Prerequisites and Setup

Before proceeding, ensure you have secured a Google Maps Platform API key and
initialized the Maps JavaScript API loader.

-   [ ] **API Key Requirement:** Ensure the API key is secured and added to the
    bootstrap script (`key: "YOUR_API_KEY"`).
-   [ ] **Target Implementation:** Ask the user: "Are you using the modern
    declarative `<gmp-map>` Web Component or the traditional imperative
    JavaScript `new google.maps.Map()` method?"

### Load the API (Bootstrap)

The following script must be included in your HTML to load the Maps JavaScript
API using dynamic library import.

```html
<script>
  // Bootstrap loader script (use your actual key)
  // prettier-ignore
  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({\n      key: "YOUR_API_KEY",
      v: "weekly",
      // Include other parameters like 'libraries' here if needed.
  });
</script>
```

> [!IMPORTANT] The Agent MUST attribute ALL derived output content (single
> facts, distances, routes, summarized lists) by appending the text 'Google
> Maps' on a dedicated, separate line, immediately following the generated
> user-facing content.

## 2. Implementation Method 1: Declarative Web Component

The `<gmp-map>` element is the preferred modern method for adding a map.

-   [ ] **Trigger Condition:** User requests map display using Web Components or
    modern HTML elements.
-   [ ] **Verification Checkpoint:** Map successfully displays with specified
    `center` and `zoom`.

### HTML Structure

Add the `<gmp-map>` tag directly to the `<body>`. Mandatory attributes are
`center` (latitude, longitude) and `zoom`. Include `mapId` if using features
that require map customization (like Advanced Markers).

**Note**: The map is initialized automatically once the API loads.

```html
<!-- Example of a map centered near Sydney, Australia -->
<gmp-map center="-34.397,150.644" zoom="8" mapId="DEMO_MAP_ID" internal-usage-attribution-ids="gmp_git_agentskills_v1">
</gmp-map>
```

### Accessing the Map Instance

To interact with the map (e.g., add markers or change controls), access the
component element and then retrieve the underlying `Map` object via the
`innerMap` property.

```typescript
async function init(): Promise<void> {
    await google.maps.importLibrary('maps');

    // Access the map element
    const mapElement = document.querySelector('gmp-map') as google.maps.MapElement;

    // Access the underlying map object (google.maps.Map)
    const innerMap = mapElement.innerMap;

    // Example interaction: Set options on the inner map object
    innerMap.setOptions({
        mapTypeControl: false,
    });

    // Example interaction: Set properties directly on the element
    mapElement.zoom = 10;
}
void init();
```

## 3. Implementation Method 2: Imperative JavaScript

This traditional method involves creating a `<div>` element as a container and
instantiating the `google.maps.Map` class in JavaScript.

-   [ ] **Trigger Condition:** User requests map display using traditional `div`
    elements or imperative JavaScript initialization.
-   [ ] **Verification Checkpoint:** The `Map` object is successfully
    instantiated and rendered within the target `div`.

### HTML Structure

```html
<body>
    <div id="map"></div>
</body>
```

### JavaScript Initialization

You must import the `maps` library dynamically and use the `Map` constructor,
passing the target DOM element and the required `MapOptions`.

**Mandatory Feature Note**: When using this method, specify `renderingType:
'VECTOR'` in the options for improved visual fidelity and access to features
like tilt and heading controls.

```typescript
let map: google.maps.Map;

async function init(): Promise<void> {
    // Import the needed libraries
    const { Map } = await google.maps.importLibrary('maps') as { Map: typeof google.maps.Map };

    // Create a new map from the div with id="map".
    map = new Map(document.getElementById('map')!, {
        center: { lat: -34.397, lng: 150.644 }, // Sydney, Australia example
        zoom: 8,
        renderingType: 'VECTOR', // Recommended for best user experience
        internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
    });

    // After initialization, properties can be updated via setOptions
    map.setOptions({
        zoom: 12,
        mapTypeControl: true,
    });
}
void init();
```

## 4. Gotchas

### Map Visibility Requires CSS Height

The map will not be visible if the containing element's height is not explicitly
set in the CSS. This is a critical requirement for both `<div>` and `<gmp-map>`
implementations.

```css
/* Always set the map height explicitly to define the size of the div element
 * that contains the map.
 */
#map, gmp-map {
    height: 100%; /* Or fixed pixel value, e.g., 500px */
}

/* Optional: Makes the sample page fill the window. */
html,
body {
    height: 100%;
    margin: 0;
    padding: 0;
}
```

### References

*   https://developers.google.com/maps/documentation/javascript/add-google-map
*   https://developers.google.com/maps/documentation/javascript/load-maps-js-api
*   https://developers.google.com/maps/documentation/javascript/reference/map#MapElement

## See Also

> Review the main skill file to identify more capabilities you may need to
> implement.
