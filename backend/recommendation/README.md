# Market Basket Model (Apriori)

This folder contains a training pipeline for association-rule recommendations using your transaction dataset.

## Input

Expected CSV format (already matched by your file):

- `Transaction_ID`
- `Items` (comma-separated item names per transaction)

## Setup

```bash
cd backend/recommendation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Train the model

```bash
python train_apriori.py \
  --input ./data/Final_Apple_Apriori_Dataset.csv \
  --output-dir ./output \
  --min-support 0.005 \
  --min-confidence 0.25 \
  --top-k 10
```

## Output files

- `output/frequent_itemsets.csv`
- `output/association_rules.csv`
- `output/recommendations_map.json`

## How to use in your backend

`recommendations_map.json` structure:

```json
{
  "Mac Mini": [
    {
      "item": "Apple Magic Mouse",
      "support": 0.123,
      "confidence": 0.89,
      "lift": 2.34
    }
  ]
}
```

For a product name, fetch its array and show top recommended products in the product details page.
