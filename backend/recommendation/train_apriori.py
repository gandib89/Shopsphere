import argparse
import json
import re
from pathlib import Path

import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder



def normalize_item_name(name: str) -> str:
    """Normalize product names to merge spelling/spacing variants."""
    # Lowercase and replace separators
    normalized = name.lower()
    normalized = normalized.replace("-", " ").replace("_", " ")
    
    # Strip Apple Watch "Series N" suffix → "Apple Watch Series 9" → "Apple Watch"
    normalized = re.sub(r'\bapple watch series\s*\d+\b', 'apple watch', normalized)
    # Strip standalone trailing version numbers from Apple Watch Ultra → "Ultra 2" → "Ultra"
    normalized = re.sub(r'\b(apple watch ultra)\s*\d+\b', r'\1', normalized)
    # Strip iPad chip/size suffixes (e.g. "M4", "M2", "11 inch", "13 inch")
    normalized = re.sub(r'\bm\d\b', '', normalized)
    normalized = re.sub(r'\b\d{2}[\s-]?inch\b', '', normalized)
    
    # Collapse whitespace
    normalized = " ".join(normalized.split())
    
    # Capitalize known Apple product terms consistently
    words = normalized.split()
    capitalized = []
    for word in words:
        if word in ("iphone", "ipad", "macbook", "airpods", "mac", "apple", "pro", "max", "air", "mini", "ultra"):
            capitalized.append(word.capitalize())
        elif word.isdigit():
            capitalized.append(word)
        else:
            capitalized.append(word.title())
    
    return " ".join(capitalized)


def parse_items(raw: str) -> list[str]:
    """Parse comma-separated items and normalize each name."""
    items = [item.strip() for item in str(raw).split(",") if item.strip()]
    return [normalize_item_name(item) for item in items]


def frozenset_to_list(value) -> list[str]:
    if isinstance(value, frozenset):
        return sorted(list(value))
    if isinstance(value, (set, list, tuple)):
        return sorted(list(value))
    return [str(value)]


def build_recommendation_map(rules_df: pd.DataFrame, top_k: int = 5) -> dict:
    recommendation_map: dict[str, list[dict]] = {}

    for _, row in rules_df.iterrows():
        antecedents = frozenset_to_list(row["antecedents"])
        consequents = frozenset_to_list(row["consequents"])

        if not antecedents or not consequents:
            continue

        # Create directional recommendations for every item in antecedents.
        # This lets products with low standalone support still benefit from
        # strong combination rules.
        for source_item in antecedents:
            for target_item in consequents:
                recommendation_map.setdefault(source_item, []).append(
                    {
                        "item": target_item,
                        "support": round(float(row["support"]), 6),
                        "confidence": round(float(row["confidence"]), 6),
                        "lift": round(float(row["lift"]), 6),
                    }
                )

    for source_item, recs in recommendation_map.items():
        deduped: dict[str, dict] = {}
        for rec in recs:
            existing = deduped.get(rec["item"])
            if not existing:
                deduped[rec["item"]] = rec
                continue

            current_score = (rec["lift"], rec["confidence"], rec["support"])
            existing_score = (
                existing["lift"],
                existing["confidence"],
                existing["support"],
            )
            if current_score > existing_score:
                deduped[rec["item"]] = rec

        recs = list(deduped.values())
        recs.sort(key=lambda x: (x["lift"], x["confidence"], x["support"]), reverse=True)
        recommendation_map[source_item] = recs[:top_k]

    return recommendation_map


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Apriori market-basket model")
    parser.add_argument(
        "--input",
        default="./data/Final_Apple_Apriori_Dataset_v2.csv",
        help="Path to source CSV dataset",
    )
    parser.add_argument(
        "--output-dir",
        default="./output",
        help="Directory to write model output files",
    )
    parser.add_argument("--min-support", type=float, default=0.005)
    parser.add_argument("--min-confidence", type=float, default=0.25)
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(f"Dataset not found: {input_path}")

    df = pd.read_csv(input_path)
    if "Items" not in df.columns:
        raise ValueError("Dataset must contain an 'Items' column")

    transactions = df["Items"].astype(str).apply(parse_items).tolist()

    te = TransactionEncoder()
    te_array = te.fit(transactions).transform(transactions)
    basket = pd.DataFrame(te_array, columns=te.columns_)

    freq_itemsets = apriori(basket, min_support=args.min_support, use_colnames=True)

    if freq_itemsets.empty:
        raise ValueError(
            "No frequent itemsets generated. Lower --min-support and try again."
        )

    rules = association_rules(
        freq_itemsets,
        metric="confidence",
        min_threshold=args.min_confidence,
    )

    if rules.empty:
        raise ValueError(
            "No association rules generated. Lower --min-confidence and try again."
        )

    rules_sorted = rules.sort_values(
        ["lift", "confidence", "support"], ascending=False
    ).reset_index(drop=True)

    recommendation_map = build_recommendation_map(rules_sorted, top_k=args.top_k)

    freq_itemsets_out = output_dir / "frequent_itemsets.csv"
    rules_out = output_dir / "association_rules.csv"
    recommendations_out = output_dir / "recommendations_map.json"

    freq_itemsets.to_csv(freq_itemsets_out, index=False)

    rules_export = rules_sorted.copy()
    rules_export["antecedents"] = rules_export["antecedents"].apply(
        lambda x: " | ".join(frozenset_to_list(x))
    )
    rules_export["consequents"] = rules_export["consequents"].apply(
        lambda x: " | ".join(frozenset_to_list(x))
    )
    rules_export.to_csv(rules_out, index=False)

    with open(recommendations_out, "w", encoding="utf-8") as f:
        json.dump(recommendation_map, f, indent=2)

    print("\nTop 25 rules by lift/confidence/support:\n")
    print(
        rules_sorted[
            ["antecedents", "consequents", "support", "confidence", "lift"]
        ].head(25)
    )
    print("\nSaved:")
    print(f"- {freq_itemsets_out}")
    print(f"- {rules_out}")
    print(f"- {recommendations_out}")


if __name__ == "__main__":
    main()
