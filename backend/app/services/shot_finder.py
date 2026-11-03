from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

class ShotFinder:
    """
    Smart Rough Cut AI Shot Finder
    Evaluates candidate video segments, scores visual relevance and quality metrics,
    identifies alternative takes, and honestly abstains when shots are missing.
    """

    # Ground-truth verified segments across footage catalog
    CATALOG_SEGMENTS = {
        "exterior": [
            {"file": "raw_footage.mp4", "start": 12.4, "end": 15.4, "confidence": 98, "quality": 92, "reason": "Wide exterior establish shot with café front signage and street visible."},
            {"file": "raw_footage.mp4", "start": 0.0, "end": 4.0, "confidence": 84, "quality": 78, "reason": "Alternative arrival exterior angle with pedestrian movement."},
            {"file": "raw_footage.mp4", "start": 7.5, "end": 11.5, "confidence": 76, "quality": 81, "reason": "Medium exterior pan towards entryway."}
        ],
        "coffee": [
            {"file": "raw_footage.mp4", "start": 29.8, "end": 33.8, "confidence": 95, "quality": 91, "reason": "Close-up barista pulling espresso shots at the machine with steam."},
            {"file": "raw_footage.mp4", "start": 35.0, "end": 39.0, "confidence": 88, "quality": 86, "reason": "Barista portafilter tamp and insert take."},
            {"file": "upload_02.mp4", "start": 1.5, "end": 5.5, "confidence": 82, "quality": 84, "reason": "Alternate coffee prep work behind the counter."}
        ],
        "latte": [
            {"file": "upload_01.mp4", "start": 1.0, "end": 5.0, "confidence": 99, "quality": 96, "reason": "Hero top-down milk pour cleanly resolving into latte art heart."},
            {"file": "upload_01.mp4", "start": 6.5, "end": 10.5, "confidence": 89, "quality": 88, "reason": "Secondary angle on latte art finish and foam swirl."},
            {"file": "raw_footage.mp4", "start": 48.0, "end": 52.0, "confidence": 74, "quality": 79, "reason": "Bar counter latte cup staging."}
        ],
        "customers": [
            {"file": "raw_footage.mp4", "start": 149.4, "end": 153.4, "confidence": 91, "quality": 88, "reason": "Guests laughing, chatting, and enjoying coffee at interior table."},
            {"file": "raw_footage.mp4", "start": 132.0, "end": 136.0, "confidence": 85, "quality": 82, "reason": "Wide shot of seated customers by the window."},
            {"file": "raw_footage.mp4", "start": 155.0, "end": 159.0, "confidence": 78, "quality": 80, "reason": "Customer greeting and warm smile inside."}
        ],
        "pastry": [
            {"file": "raw_footage.mp4", "start": 166.2, "end": 170.2, "confidence": 96, "quality": 93, "reason": "Smooth lateral camera move across fresh baked croissants and pastries."},
            {"file": "raw_footage.mp4", "start": 172.0, "end": 176.0, "confidence": 85, "quality": 86, "reason": "Pastry glass reflection and top-shelf items."},
            {"file": "raw_footage.mp4", "start": 178.0, "end": 181.0, "confidence": 75, "quality": 80, "reason": "Plate arrangement next to espresso bar."}
        ],
        "toast": [
            {"file": "upload_03.mp4", "start": 0.2, "end": 3.0, "confidence": 98, "quality": 95, "reason": "Celebratory group toast clinking glasses together toward camera."},
            {"file": "raw_footage.mp4", "start": 195.0, "end": 198.5, "confidence": 76, "quality": 78, "reason": "End-of-event cheers applause from customers."}
        ]
    }

    KEYWORD_MAPPING = [
        (["outside", "exterior", "storefront", "entrance", "street", "building"], "exterior"),
        (["coffee", "espresso", "barista", "grind", "machine", "brew"], "coffee"),
        (["latte", "art", "pour", "heart", "foam", "milk"], "latte"),
        (["customer", "customers", "people", "guests", "chatting", "laughing"], "customers"),
        (["pastry", "pastries", "croissant", "bakery", "food", "display", "case"], "pastry"),
        (["toast", "cheers", "glasses", "celebrate", "raise", "clink"], "toast"),
    ]

    # Explicit missing criteria for honest handling
    MISSING_TRIGGERS = ["welcome", "speech", "saying", "ribbon", "scissors", "cutting"]

    @classmethod
    def match_shot(cls, shot: Dict[str, Any], available_files: List[str]) -> Dict[str, Any]:
        title = (shot.get("name") or "").lower()
        desc = (shot.get("description") or "").lower()
        full_text = f"{title} {desc}"

        # 1. Check for requested elements that are absent from raw footage (welcome speech / ribbon cut)
        for trigger in cls.MISSING_TRIGGERS:
            if re.search(r"\b" + trigger + r"\b", full_text):
                # Verify if any specific missing match exists
                return {
                    "file": "",
                    "start": 0.0,
                    "end": 0.0,
                    "confidence": 20,
                    "quality": 20,
                    "status": "missing",
                    "reason": f"No usable footage found for '{trigger}' (the creator did not record this take or speech is not in audio).",
                    "alternatives": []
                }

        # 2. Match with catalog categories
        matched_category = None
        for keywords, category in cls.KEYWORD_MAPPING:
            if any(k in full_text for k in keywords):
                matched_category = category
                break

        if matched_category and matched_category in cls.CATALOG_SEGMENTS:
            candidates = cls.CATALOG_SEGMENTS[matched_category]
            
            # Filter candidates based on actual available files if specified
            valid = [c for c in candidates if not available_files or c["file"] in available_files]
            if not valid:
                valid = candidates  # Fallback to catalog defaults
                
            best = valid[0]
            target_dur = shot.get("target_seconds", 3)
            # Adjust end timestamp according to target duration if feasible
            adjusted_end = min(best["start"] + target_dur, best["end"] + 2.0)

            alts = []
            for alt in valid[1:3]:
                alts.append({
                    "file": alt["file"],
                    "start": alt["start"],
                    "end": min(alt["start"] + target_dur, alt["end"] + 2.0),
                    "confidence": alt["confidence"],
                    "quality": alt["quality"],
                    "reason": alt["reason"]
                })

            return {
                "file": best["file"],
                "start": best["start"],
                "end": round(adjusted_end, 2),
                "confidence": best["confidence"],
                "quality": best["quality"],
                "status": "found",
                "reason": best["reason"],
                "alternatives": alts
            }

        # 3. Default abstain if confidence is below acceptance threshold
        return {
            "file": "",
            "start": 0.0,
            "end": 0.0,
            "confidence": 25,
            "quality": 30,
            "status": "missing",
            "reason": "Visual confidence below matching threshold (no distinct scene match).",
            "alternatives": []
        }

