"""Generate a realistic market-basket dataset for the ShopSphere Apriori model.

Why generated instead of hand-written: 10k+ transactions cannot be authored by
hand, and a real store's baskets are probabilistic, not enumerated. The
probabilities below are attach rates that mirror how Apple-ecosystem stores
actually sell (a phone ships without a charger, a Mac mini ships without a
keyboard or mouse, a watch buyer nearly always adds a band).

Two levels of items go into every transaction:

1. Concrete product names ("iPhone 17 Pro Max", "Apple 20W USB-C Power Adapter").
2. The store category of each of those products ("iPhone", "Accessories").

The category rows are what make the model useful for products this dataset has
never seen. When a seller uploads "Nova Ultra Glass Screen Guard", no rule
mentions it by name, but the rules learned for its category still do, so the API
can fall back from name to category and still return something a shopper would
plausibly buy alongside it. This is standard generalized (multi-level)
association-rule mining, not a hack.

Run:
    python generate_dataset.py --rows 12000 --out ./data/shopsphere_market_basket.csv
"""

import argparse
import csv
import random
from pathlib import Path

# Store taxonomy - must stay in sync with the category <select> in
# frontend/src/pages/AddProduct.tsx.
CATEGORY_OF = {}


def catalog(category, *names):
    for name in names:
        CATEGORY_OF[name] = category
    return list(names)


IPHONES = catalog(
    "iPhone",
    "iPhone 17 Pro Max",
    "iPhone 17 Pro",
    "iPhone 17",
    "iPhone 16 Pro",
    "iPhone 16",
    "iPhone 15",
    "iPhone SE",
)

MACBOOKS = catalog(
    "MacBook",
    "MacBook Air 13-inch",
    "MacBook Air 15-inch",
    "MacBook Pro 14-inch",
    "MacBook Pro 16-inch",
)

MAC_MINIS = catalog("Mac Mini", "Mac mini M4", "Mac mini M4 Pro")

IPADS = catalog("iPad", "iPad Pro M4", "iPad Air M3", "iPad (A16)", "iPad mini 7")

WATCHES = catalog(
    "Apple Watch",
    "Apple Watch Series 10",
    "Apple Watch Ultra 2",
    "Apple Watch SE",
)

SPEAKERS = catalog(
    "Speakers",
    "HomePod mini",
    "Marshall Middleton Portable Bluetooth Speaker",
    "JBL Flip 6 Bluetooth Speaker",
    "Bose SoundLink Flex Speaker",
    "Sony SRS-XB100 Speaker",
)

# Accessories carry the long tail. Third-party brands are here on purpose: they
# are what independent sellers actually list, so their names need to appear in
# the rules.
PHONE_CASES = catalog(
    "Accessories",
    "iPhone Silicone Case with MagSafe",
    "iPhone Clear Case",
    "Spigen Rugged Armor Phone Case",
    "ESR MagSafe Phone Case",
)
SCREEN_PROTECTORS = catalog(
    "Accessories",
    "iPhone Tempered Glass Screen Protector",
    "iPad Screen Protector",
    "Apple Watch Screen Protector",
)
ADAPTERS = catalog(
    "Accessories",
    "Apple 20W USB-C Power Adapter",
    "Apple 30W USB-C Power Adapter",
    "Apple 96W USB-C Power Adapter",
    "Anker 65W GaN Charger",
)
CABLES = catalog(
    "Accessories",
    "USB-C Charge Cable",
    "USB-C to Lightning Cable",
    "Thunderbolt 4 Cable",
    "HDMI Cable",
    "3.5mm Aux Cable",
)
CHARGING = catalog(
    "Accessories",
    "MagSafe Charger",
    "Belkin MagSafe 3-in-1 Charging Stand",
    "Anker 10000mAh Power Bank",
    "Apple Watch Charging Dock",
)
AUDIO = catalog("Accessories", "AirPods Pro 2", "AirPods 4", "AirPods Max")
AUDIO_EXTRAS = catalog(
    "Accessories",
    "AirPods Silicone Case Cover",
    "Replacement Silicone Ear Tips",
)
DESKTOP = catalog(
    "Accessories",
    "Apple Magic Keyboard",
    "Apple Magic Mouse",
    "Apple Magic Trackpad",
    "Logitech MX Master 3S Mouse",
    "27-inch 4K Monitor",
    "Adjustable Monitor Stand",
    "1080p Webcam",
)
IPAD_EXTRAS = catalog(
    "Accessories",
    "Apple Pencil Pro",
    "Apple Pencil (USB-C)",
    "iPad Magic Keyboard",
    "iPad Smart Folio",
)
WATCH_BANDS = catalog(
    "Accessories",
    "Apple Watch Sport Band",
    "Apple Watch Milanese Loop",
    "Apple Watch Braided Solo Loop",
)
CARRY = catalog(
    "Accessories",
    "13-inch Laptop Sleeve",
    "Laptop Backpack",
    "Speaker Carrying Case",
)
STORAGE = catalog(
    "Accessories",
    "Samsung T7 1TB Portable SSD",
    "SanDisk 128GB microSD Card",
    "Anker 7-in-1 USB-C Hub",
    "USB-C Docking Station",
)
CARE = catalog(
    "Accessories",
    "Screen Cleaning Kit",
    "Microfiber Cleaning Cloth",
    "Cable Organizer Set",
    "Adjustable Phone Stand",
    "Car Phone Mount",
    "AirTag",
)

ACCESSORY_POOL = (
    PHONE_CASES + SCREEN_PROTECTORS + ADAPTERS + CABLES + CHARGING + AUDIO
    + AUDIO_EXTRAS + DESKTOP + IPAD_EXTRAS + WATCH_BANDS + CARRY + STORAGE + CARE
)

# Accessories that are genuinely bought together on their own, without an anchor
# device in the same basket (replacement, gift and top-up purchases).
ACCESSORY_AFFINITY = [
    (["Apple 20W USB-C Power Adapter"], ["USB-C Charge Cable"], 0.55),
    (["Apple 20W USB-C Power Adapter"], ["USB-C to Lightning Cable"], 0.20),
    (PHONE_CASES, ["iPhone Tempered Glass Screen Protector"], 0.48),
    (PHONE_CASES, ["Adjustable Phone Stand"], 0.10),
    (["MagSafe Charger"], ["Apple 20W USB-C Power Adapter"], 0.42),
    (["Belkin MagSafe 3-in-1 Charging Stand"], ["Apple Watch Charging Dock"], 0.18),
    (AUDIO, ["AirPods Silicone Case Cover"], 0.33),
    (AUDIO, ["Replacement Silicone Ear Tips"], 0.20),
    (["Apple Magic Keyboard"], ["Apple Magic Mouse"], 0.46),
    (["Apple Magic Mouse"], ["Apple Magic Trackpad"], 0.13),
    (["27-inch 4K Monitor"], ["HDMI Cable"], 0.44),
    (["27-inch 4K Monitor"], ["Adjustable Monitor Stand"], 0.21),
    (["Anker 7-in-1 USB-C Hub"], ["Samsung T7 1TB Portable SSD"], 0.17),
    (["13-inch Laptop Sleeve"], ["Microfiber Cleaning Cloth"], 0.14),
    (WATCH_BANDS, ["Apple Watch Screen Protector"], 0.22),
    (["Apple Pencil Pro", "Apple Pencil (USB-C)"], ["iPad Screen Protector"], 0.26),
]

# (share of all baskets, anchor pool, [(attachment pool, attach rate)]).
ANCHORS = [
    (
        0.20,
        IPHONES,
        [
            (PHONE_CASES, 0.62),
            (["iPhone Tempered Glass Screen Protector"], 0.44),
            (["Apple 20W USB-C Power Adapter"], 0.46),
            (["USB-C Charge Cable"], 0.30),
            (["USB-C to Lightning Cable"], 0.10),
            (["MagSafe Charger"], 0.19),
            (["Belkin MagSafe 3-in-1 Charging Stand"], 0.07),
            (["Anker 10000mAh Power Bank"], 0.12),
            (AUDIO, 0.16),
            (["AirTag"], 0.06),
            (["Car Phone Mount"], 0.08),
            (["Adjustable Phone Stand"], 0.07),
            (WATCHES, 0.05),
        ],
    ),
    (
        0.09,
        MACBOOKS,
        [
            (["13-inch Laptop Sleeve"], 0.34),
            (["Laptop Backpack"], 0.14),
            (["Anker 7-in-1 USB-C Hub"], 0.33),
            (["USB-C Docking Station"], 0.11),
            (["Apple Magic Mouse"], 0.26),
            (["Logitech MX Master 3S Mouse"], 0.09),
            (["Samsung T7 1TB Portable SSD"], 0.16),
            (["Apple 96W USB-C Power Adapter"], 0.12),
            (["Thunderbolt 4 Cable"], 0.10),
            (["27-inch 4K Monitor"], 0.11),
            (["Screen Cleaning Kit"], 0.09),
            (["Microfiber Cleaning Cloth"], 0.12),
            (IPHONES, 0.04),
        ],
    ),
    (
        # A Mac mini ships with no keyboard, mouse or display, so the attach
        # rates here are the highest in the store. This is the single strongest
        # real-world rule the model should learn.
        0.06,
        MAC_MINIS,
        [
            (["Apple Magic Keyboard"], 0.57),
            (["Apple Magic Mouse"], 0.52),
            (["Apple Magic Trackpad"], 0.18),
            (["27-inch 4K Monitor"], 0.34),
            (["HDMI Cable"], 0.29),
            (["Anker 7-in-1 USB-C Hub"], 0.21),
            (["USB-C Docking Station"], 0.14),
            (["1080p Webcam"], 0.16),
            (["Adjustable Monitor Stand"], 0.12),
        ],
    ),
    (
        0.10,
        IPADS,
        [
            (["Apple Pencil Pro"], 0.30),
            (["Apple Pencil (USB-C)"], 0.18),
            (["iPad Magic Keyboard"], 0.24),
            (["iPad Smart Folio"], 0.33),
            (["iPad Screen Protector"], 0.28),
            (["Apple 20W USB-C Power Adapter"], 0.22),
            (["USB-C Charge Cable"], 0.24),
            (AUDIO, 0.11),
        ],
    ),
    (
        0.08,
        WATCHES,
        [
            (WATCH_BANDS, 0.44),
            (["Apple Watch Screen Protector"], 0.22),
            (["Apple Watch Charging Dock"], 0.26),
            (["Apple 20W USB-C Power Adapter"], 0.15),
            (["Belkin MagSafe 3-in-1 Charging Stand"], 0.09),
        ],
    ),
    (
        0.07,
        SPEAKERS,
        [
            (["Speaker Carrying Case"], 0.19),
            (["USB-C Charge Cable"], 0.22),
            (["3.5mm Aux Cable"], 0.14),
            (["Apple 20W USB-C Power Adapter"], 0.18),
            (["Anker 10000mAh Power Bank"], 0.08),
        ],
    ),
    (
        0.07,
        AUDIO,
        [
            (["AirPods Silicone Case Cover"], 0.34),
            (["Replacement Silicone Ear Tips"], 0.21),
            (["USB-C Charge Cable"], 0.15),
            (["Screen Cleaning Kit"], 0.10),
            (["MagSafe Charger"], 0.07),
        ],
    ),
]

# The remaining share are accessory-only baskets. Real stores ring up far more
# small accessory baskets than device baskets, so that share is deliberately big.
ANCHOR_SHARE = sum(weight for weight, _, _ in ANCHORS)


def accessory_basket(rng):
    size = rng.choices([1, 2, 3], weights=[0.55, 0.30, 0.15])[0]
    basket = {rng.choice(ACCESSORY_POOL)}
    while len(basket) < size:
        basket.add(rng.choice(ACCESSORY_POOL))
    return basket


def anchor_basket(rng, roll):
    cursor = 0.0
    for weight, anchors, attachments in ANCHORS:
        cursor += weight
        if roll < cursor:
            basket = {rng.choice(anchors)}
            for pool, probability in attachments:
                if rng.random() < probability:
                    basket.add(rng.choice(pool))
            return basket
    return accessory_basket(rng)


def apply_affinity(rng, basket):
    for sources, targets, probability in ACCESSORY_AFFINITY:
        if basket.intersection(sources) and rng.random() < probability:
            basket.add(rng.choice(targets))
    return basket


def build_transaction(rng):
    roll = rng.random()
    basket = anchor_basket(rng, roll) if roll < ANCHOR_SHARE else accessory_basket(rng)
    basket = apply_affinity(rng, basket)
    categories = {CATEGORY_OF[item] for item in basket}
    # Category rows come last so a human reading the CSV sees products first.
    return sorted(basket) + sorted(categories)


def main():
    parser = argparse.ArgumentParser(description="Generate ShopSphere basket data")
    parser.add_argument("--rows", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=20260904)
    parser.add_argument("--out", default="./data/shopsphere_market_basket.csv")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Transaction_ID", "Items"])
        for index in range(1, args.rows + 1):
            writer.writerow([f"T{index}", ", ".join(build_transaction(rng))])

    print(f"Wrote {args.rows} transactions to {out_path}")
    print(
        f"Distinct items: {len(CATEGORY_OF)} products "
        f"+ {len(set(CATEGORY_OF.values()))} categories"
    )


if __name__ == "__main__":
    main()
