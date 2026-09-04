# Market Basket Model (Apriori)

Association-rule recommendations for the product details page. Three files matter:

| File | Role |
| --- | --- |
| `generate_dataset.py` | Builds the transaction dataset from real-world attach rates |
| `data/shopsphere_market_basket.csv` | The dataset (12,000 transactions, committed) |
| `train_apriori.py` | Runs Apriori over it and writes `output/` |

## The dataset

`data/shopsphere_market_basket.csv` has the format the trainer expects:

- `Transaction_ID`
- `Items` — comma-separated item names for that basket

Baskets are modelled on how an Apple-ecosystem store actually sells, not on
random pairings:

- A phone ships without a charger, so a 20W adapter attaches to ~46% of iPhone
  baskets, a case to ~62%, a tempered-glass protector to ~44%.
- A Mac mini ships with no keyboard, mouse or display — the highest attach
  rates in the store, and the strongest rule the model learns.
- An iPad buyer adds a Pencil, a Folio or a Magic Keyboard; a Watch buyer adds
  a band; AirPods buyers add a case cover and ear tips.
- Most baskets are small. Accessory-only baskets (one to three items) outnumber
  device baskets, which is what a real till roll looks like.

Third-party brands (Spigen, ESR, Anker, Belkin, Logitech, Samsung, SanDisk) are
in the item list on purpose: those are the names independent sellers list, so
the rules have to contain them for a seller's product to match anything.

### Why it also works for products nobody has seen

Every transaction carries two levels of items: the product names, and the store
**category** of each of those products (`iPhone`, `MacBook`, `Mac Mini`, `iPad`,
`Apple Watch`, `Speakers`, `Accessories` — the list in
`frontend/src/pages/AddProduct.tsx`).

That means the trained model has rules keyed on categories as well as on product
names. When a seller uploads "Nova Ultra Glass Screen Guard", no rule mentions it
by name, but `Accessories → …` does, so `getProductRecommendations` falls back
from name to category and still returns something a shopper would plausibly buy
with it. This is generalized (multi-level) association-rule mining — the same
idea as Srikant & Agrawal's taxonomy-aware Apriori.

Specific rules still win: they carry far higher lift than the category rules, and
the map is sorted by lift, so an exact product match is always ranked first.

## Setup

```bash
cd backend/recommendation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Regenerate the dataset

Only needed after editing the catalog or the attach rates in
`generate_dataset.py`. The seed is fixed, so the output is reproducible.

```bash
python generate_dataset.py --rows 12000
```

## Train the model

```bash
python train_apriori.py --min-support 0.005 --min-confidence 0.15 --top-k 10
```

`--min-confidence` is deliberately low. Confidence is diluted whenever a product
family has several variants (three watch bands split one 44% attach rate three
ways), so lift, not confidence, is what ranks the results.

Admins can trigger the same run from the app:
`POST /api/v1/product/recommendations/retrain`.

## Output files

- `output/frequent_itemsets.csv`
- `output/association_rules.csv`
- `output/recommendations_map.json` — the only one the backend reads

## How the backend uses it

`recommendations_map.json` structure:

```json
{
  "Mac Mini": [
    { "item": "Apple Magic Keyboard", "support": 0.0281, "confidence": 0.57, "lift": 8.9 }
  ]
}
```

`controller/productController.js` looks a product's name up in that map, falls
back to its category, then fuzzy-matches the recommended names against the real
catalog. If nothing matches at all it falls back to same-category products, so
the endpoint never returns empty on a stocked store.

Keys are title-cased by `normalize_item_name` in `train_apriori.py`, which also
merges variants that recommend the same things (`Apple Watch Series 10` and
`Apple Watch` collapse to one key).

## Tests

```bash
node --test recommendation/recommendationsMap.test.js
```

Checks the committed model still reproduces the real attach behaviour (Mac mini
→ keyboard and mouse, iPhone → charger and case) and that every store category
is a key, which is what the unseen-product fallback depends on.
