// Per-zip investment criteria for Zillow listing evaluation
export const CRITERIA = {
  "15228": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 170000 },
      { type: "single family", beds: 3, maxPrice: 225000 },
      { type: "duplex", beds: 4, maxPrice: 300000 },
      { type: "duplex", beds: 5, maxPrice: 350000 },
    ],
  },
  "15243": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 170000 },
      { type: "single family", beds: 3, maxPrice: 225000 },
      { type: "duplex", beds: 4, maxPrice: 300000 },
      { type: "duplex", beds: 5, maxPrice: 350000 },
    ],
  },
  "15234": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 140000 },
      { type: "single family", beds: 3, maxPrice: 175000 },
      { type: "duplex", beds: 4, maxPrice: 250000 },
      { type: "duplex", beds: 5, maxPrice: 300000 },
    ],
  },
  "15212": {
    excluded: ["condo", "lot", "land", "vacant"],
    rules: [{ type: "any", maxPrice: 200000 }],
  },
};
