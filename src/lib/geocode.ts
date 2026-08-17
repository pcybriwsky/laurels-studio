// Reverse-geocode a run's start point to a short place label for the badge top.
// BigDataCloud's client endpoint is free, keyless, and CORS-open — built for
// exactly this. The result only PREFILLS the location field (usually a city
// name like "BROOKLYN"); the label actually stitched is whatever gets typed in
// the Lab, so the glyph stays deterministic from its stored inputs.
export async function reverseGeocodeLabel(lat: number, lng: number): Promise<string | null> {
  const url =
    "https://api.bigdatacloud.net/data/reverse-geocode-client" +
    `?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data: { city?: string; locality?: string; principalSubdivision?: string; countryName?: string } =
    await res.json();
  const label = data.city || data.locality || data.principalSubdivision || data.countryName;
  return label ? label.toUpperCase() : null;
}
