import hashlib
import os
import re
import shutil
import time
from dataclasses import dataclass
from typing import Any

try:
    import cv2
except ModuleNotFoundError:  # pragma: no cover - exercised by dependency-aware tests
    cv2 = None  # type: ignore[assignment]

try:
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - exercised by dependency-aware tests
    np = None  # type: ignore[assignment]

try:
    import pytesseract
except ModuleNotFoundError:  # pragma: no cover - exercised by dependency-aware tests
    pytesseract = None  # type: ignore[assignment]

OCR_TOOL_NAME = "external-tesseract-ocr-worker"
OCR_TOOL_VERSION = "0.1.0"
OCR_SOURCE = "tesseract_ocr"
OCR_ENABLED = os.environ.get("TESSERACT_OCR_ENABLED", "true").lower() not in {"0", "false", "no", "off"}
OCR_LANGUAGE = os.environ.get("TESSERACT_OCR_LANGUAGE", "eng")
OCR_MIN_CONFIDENCE = float(os.environ.get("TESSERACT_OCR_MIN_CONFIDENCE", "35"))
OCR_MAX_CROPS = int(os.environ.get("TESSERACT_OCR_MAX_CROPS", "8"))
OCR_MAX_CANDIDATES = int(os.environ.get("TESSERACT_OCR_MAX_CANDIDATES", "18"))
OCR_MIN_TEXT_LENGTH = int(os.environ.get("TESSERACT_OCR_MIN_TEXT_LENGTH", "2"))
OCR_CONFIG = os.environ.get("TESSERACT_OCR_CONFIG", "--oem 3 --psm 6")

BASE_OCR_LIMITATIONS = [
    "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
    "Tesseract OCR text is extracted from survey photo pixels and may be incomplete, misread, rotated, blurred, occluded, or contextually wrong.",
    "OCR candidates are review cues only and cannot mutate canonical evidence, CAD geometry, permit inputs, BOM inputs, or engineering workflows.",
]

EQUIPMENT_HINT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("breaker_rating_candidate", re.compile(r"\b(?:[1-9]\d{1,3})\s*(?:A|AMP|AMPS|AMPERE|AMPERES)\b", re.IGNORECASE)),
    ("voltage_rating_candidate", re.compile(r"\b(?:120|208|240|277|480)\s*(?:V|VAC|VOLTS?)\b", re.IGNORECASE)),
    ("main_service_panel_label_candidate", re.compile(r"\b(?:MAIN\s+SERVICE|MAIN\s+PANEL|SERVICE\s+PANEL|MSP|PANELBOARD|LOAD\s+CENTER)\b", re.IGNORECASE)),
    ("utility_meter_label_candidate", re.compile(r"\b(?:METER|UTILITY|KWH|CL\s*\d+)\b", re.IGNORECASE)),
    ("disconnect_label_candidate", re.compile(r"\b(?:DISCONNECT|AC\s+DISC|DC\s+DISC|SAFETY\s+SWITCH)\b", re.IGNORECASE)),
    ("inverter_label_candidate", re.compile(r"\b(?:INVERTER|MICROINVERTER|ENPHASE|SOLAREDGE|SMA|FRONIUS)\b", re.IGNORECASE)),
    ("battery_label_candidate", re.compile(r"\b(?:BATTERY|ENERGY\s+STORAGE|POWERWALL|ESS)\b", re.IGNORECASE)),
    ("manufacturer_model_candidate", re.compile(r"\b(?:MODEL|MOD|CAT|TYPE|SERIAL|S/?N|NO\.)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._/-]{2,}\b", re.IGNORECASE)),
    ("warning_label_candidate", re.compile(r"\b(?:WARNING|CAUTION|DANGER|ELECTRICAL|PHOTOVOLTAIC|PV)\b", re.IGNORECASE)),
]

@dataclass
class OcrAvailability:
    tesseract: dict[str, Any]
    pytesseract: dict[str, Any]


def _version(value: Any) -> str | None:
    try:
        return str(value()) if callable(value) else str(value)
    except Exception:
        return None


def _stable_hash(value: Any) -> str:
    import json
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def clean_text(text: str) -> str:
    text = text.replace("\x0c", " ")
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" |:;,.\u2022-_\u2014")
    return text[:260]


def equipment_hints(text: str) -> list[dict[str, str]]:
    hints: list[dict[str, str]] = []
    for kind, pattern in EQUIPMENT_HINT_PATTERNS:
        for match in pattern.finditer(text):
            value = clean_text(match.group(0))
            if value and not any(item["kind"] == kind and item["value"].lower() == value.lower() for item in hints):
                hints.append({"kind": kind, "value": value})
    return hints[:8]


def normalize_bbox(x: int, y: int, w: int, h: int, width: int, height: int) -> dict[str, Any]:
    return {
        "x": int(round(max(0, x) / max(1, width) * 1000)),
        "y": int(round(max(0, y) / max(1, height) * 1000)),
        "width": int(round(max(1, min(w, width)) / max(1, width) * 1000)),
        "height": int(round(max(1, min(h, height)) / max(1, height) * 1000)),
        "coordinateSystem": "normalized_image_0_1000",
    }


def denormalize_region(region: dict[str, Any], width: int, height: int, padding: float = 0.08) -> tuple[int, int, int, int] | None:
    try:
        x = float(region.get("x", 0)) / 1000.0 * width
        y = float(region.get("y", 0)) / 1000.0 * height
        w = float(region.get("width", 0)) / 1000.0 * width
        h = float(region.get("height", 0)) / 1000.0 * height
    except (TypeError, ValueError):
        return None
    if w < 4 or h < 4:
        return None
    pad_x = w * padding
    pad_y = h * padding
    x0 = max(0, int(round(x - pad_x)))
    y0 = max(0, int(round(y - pad_y)))
    x1 = min(width, int(round(x + w + pad_x)))
    y1 = min(height, int(round(y + h + pad_y)))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1 - x0, y1 - y0


class TesseractOcrService:
    def __init__(self) -> None:
        self.language = OCR_LANGUAGE
        self.min_confidence = OCR_MIN_CONFIDENCE
        self.max_crops = OCR_MAX_CROPS
        self.max_candidates = OCR_MAX_CANDIDATES
        self.config = OCR_CONFIG
        self._availability: OcrAvailability | None = None

    def availability(self) -> OcrAvailability:
        if self._availability is not None:
            return self._availability
        if not OCR_ENABLED:
            self._availability = OcrAvailability(
                tesseract={"available": False, "reason": "tesseract_ocr_disabled_by_env"},
                pytesseract={"available": pytesseract is not None, "version": getattr(pytesseract, "__version__", None) if pytesseract else None},
            )
            return self._availability
        binary = shutil.which("tesseract")
        if pytesseract is None:
            self._availability = OcrAvailability(
                tesseract={"available": False, "reason": "pytesseract_python_package_not_installed", "binary": binary},
                pytesseract={"available": False, "reason": "pytesseract_python_package_not_installed"},
            )
            return self._availability
        if not binary:
            self._availability = OcrAvailability(
                tesseract={"available": False, "reason": "tesseract_binary_not_found"},
                pytesseract={"available": True, "version": getattr(pytesseract, "__version__", None)},
            )
            return self._availability
        version = _version(pytesseract.get_tesseract_version)
        self._availability = OcrAvailability(
            tesseract={"available": True, "version": version, "binary": binary, "language": self.language},
            pytesseract={"available": True, "version": getattr(pytesseract, "__version__", None)},
        )
        return self._availability

    def availability_string(self) -> str:
        availability = self.availability()
        if availability.tesseract.get("available") and availability.pytesseract.get("available"):
            return f"available:tesseract:{availability.tesseract.get('version')}:pytesseract:{availability.pytesseract.get('version')}"
        return f"unavailable:{availability.tesseract.get('reason') or availability.pytesseract.get('reason') or 'tesseract_not_available'}"

    def detect(
        self,
        image: Any,
        *,
        survey_id: str,
        file_id: str,
        file_url: str,
        filename: str | None,
        byte_hash: str,
        created_at: str,
        yolo_candidates: list[dict[str, Any]] | None = None,
        include_equipment_hints: bool = True,
    ) -> dict[str, Any]:
        started = time.time()
        availability = self.availability()
        if not (availability.tesseract.get("available") and availability.pytesseract.get("available")):
            return {"available": False, "diagnostic": availability.tesseract.get("reason") or availability.pytesseract.get("reason") or "tesseract_not_available", "candidates": [], "elapsedMs": int((time.time() - started) * 1000), "limitations": BASE_OCR_LIMITATIONS}
        if cv2 is None or np is None or pytesseract is None:
            return {"available": False, "diagnostic": "opencv_numpy_or_pytesseract_not_importable", "candidates": [], "elapsedMs": int((time.time() - started) * 1000), "limitations": BASE_OCR_LIMITATIONS}
        height, width = image.shape[:2]
        crop_specs = self._crop_specs(yolo_candidates or [], width, height)
        crop_specs.append({"sourceCrop": "full_image", "region": {"x": 0, "y": 0, "width": 1000, "height": 1000, "coordinateSystem": "normalized_image_0_1000"}, "pixels": (0, 0, width, height), "sourceCandidateId": None, "sourceCandidateType": None})
        seen: set[str] = set()
        candidates: list[dict[str, Any]] = []
        for crop_index, crop_spec in enumerate(crop_specs[: self.max_crops + 1]):
            x, y, w, h = crop_spec["pixels"]
            crop = image[y : y + h, x : x + w]
            if crop.size == 0:
                continue
            for item in self._ocr_crop(crop, offset_x=x, offset_y=y, full_width=width, full_height=height):
                text = clean_text(item["text"])
                if len(text) < OCR_MIN_TEXT_LENGTH:
                    continue
                confidence = int(round(item["confidence"]))
                if confidence < self.min_confidence:
                    continue
                fingerprint = re.sub(r"\W+", "", text.lower())
                if not fingerprint or fingerprint in seen:
                    continue
                seen.add(fingerprint)
                hints = equipment_hints(text) if include_equipment_hints else []
                candidate = self._candidate(
                    survey_id=survey_id,
                    file_id=file_id,
                    file_url=file_url,
                    filename=filename,
                    byte_hash=byte_hash,
                    created_at=created_at,
                    text=text,
                    confidence=confidence,
                    bbox=item["bbox"],
                    crop_spec=crop_spec,
                    crop_index=crop_index,
                    hints=hints,
                )
                candidates.append(candidate)
                if len(candidates) >= self.max_candidates:
                    break
            if len(candidates) >= self.max_candidates:
                break
        return {"available": True, "diagnostic": None if candidates else "tesseract_completed_no_confident_text", "candidates": candidates, "elapsedMs": int((time.time() - started) * 1000), "limitations": BASE_OCR_LIMITATIONS, "model": "tesseract", "modelVersion": availability.tesseract.get("version"), "pytesseractVersion": availability.pytesseract.get("version")}

    def _crop_specs(self, yolo_candidates: list[dict[str, Any]], width: int, height: int) -> list[dict[str, Any]]:
        specs: list[dict[str, Any]] = []
        for candidate in yolo_candidates:
            payload = candidate.get("payload", {}) if isinstance(candidate.get("payload"), dict) else {}
            region = candidate.get("region") or candidate.get("bbox") or payload.get("region") or payload.get("bbox")
            if not isinstance(region, dict):
                continue
            pixels = denormalize_region(region, width, height)
            if pixels is None:
                continue
            specs.append({
                "sourceCrop": "yolo_object_bbox",
                "region": {"x": region.get("x"), "y": region.get("y"), "width": region.get("width"), "height": region.get("height"), "coordinateSystem": "normalized_image_0_1000"},
                "pixels": pixels,
                "sourceCandidateId": candidate.get("candidateId"),
                "sourceCandidateType": candidate.get("candidateType"),
                "sourceCategory": candidate.get("category") or payload.get("semanticCategory") or payload.get("category"),
            })
        specs.sort(key=lambda item: item["pixels"][2] * item["pixels"][3], reverse=True)
        return specs[: self.max_crops]

    def _preprocess(self, crop: Any) -> Any:
        if cv2 is None:
            return crop
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        scale = 2 if min(gray.shape[:2]) < 320 else 1
        if scale > 1:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.bilateralFilter(gray, 5, 35, 35)
        thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11)
        return thresh

    def _ocr_crop(self, crop: Any, *, offset_x: int, offset_y: int, full_width: int, full_height: int) -> list[dict[str, Any]]:
        if pytesseract is None:
            return []
        processed = self._preprocess(crop)
        data = pytesseract.image_to_data(processed, lang=self.language, config=self.config, output_type=pytesseract.Output.DICT)
        n = len(data.get("text", []))
        words: list[dict[str, Any]] = []
        for i in range(n):
            text = clean_text(str(data.get("text", [""])[i]))
            if not text:
                continue
            try:
                conf = float(data.get("conf", ["-1"])[i])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < 0:
                continue
            x = int(data.get("left", [0])[i])
            y = int(data.get("top", [0])[i])
            w = int(data.get("width", [0])[i])
            h = int(data.get("height", [0])[i])
            block = int(data.get("block_num", [0])[i]) if i < len(data.get("block_num", [])) else 0
            paragraph = int(data.get("par_num", [0])[i]) if i < len(data.get("par_num", [])) else 0
            line = int(data.get("line_num", [0])[i]) if i < len(data.get("line_num", [])) else int(round(y / 28))
            words.append({"text": text, "confidence": conf, "x": x, "y": y, "w": w, "h": h, "block": block, "paragraph": paragraph, "line": line})
        if not words:
            return []
        groups: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
        for word in words:
            line_key = (int(word["block"]), int(word["paragraph"]), int(word["line"]))
            groups.setdefault(line_key, []).append(word)
        out: list[dict[str, Any]] = []
        for line_words in groups.values():
            line_words.sort(key=lambda item: item["x"])
            text = clean_text(" ".join(item["text"] for item in line_words))
            if not text:
                continue
            conf = sum(item["confidence"] for item in line_words) / max(1, len(line_words))
            x0 = min(item["x"] for item in line_words)
            y0 = min(item["y"] for item in line_words)
            x1 = max(item["x"] + item["w"] for item in line_words)
            y1 = max(item["y"] + item["h"] for item in line_words)
            # Account for 2x preprocessing scale when used.
            scale = 2 if min(crop.shape[:2]) < 320 else 1
            bbox = normalize_bbox(offset_x + int(x0 / scale), offset_y + int(y0 / scale), max(1, int((x1 - x0) / scale)), max(1, int((y1 - y0) / scale)), full_width, full_height)
            out.append({"text": text, "confidence": conf, "bbox": bbox})
        out.sort(key=lambda item: item["confidence"], reverse=True)
        return out[:6]

    def _candidate(
        self,
        *,
        survey_id: str,
        file_id: str,
        file_url: str,
        filename: str | None,
        byte_hash: str,
        created_at: str,
        text: str,
        confidence: int,
        bbox: dict[str, Any],
        crop_spec: dict[str, Any],
        crop_index: int,
        hints: list[dict[str, str]],
    ) -> dict[str, Any]:
        availability = self.availability()
        payload = {
            "source": OCR_SOURCE,
            "sourceImageSha256": byte_hash,
            "sourceFileUrl": file_url,
            "text": text,
            "cleanedText": text,
            "hints": hints,
            "bbox": bbox,
            "region": bbox,
            "sourceCrop": {
                "kind": crop_spec.get("sourceCrop"),
                "region": crop_spec.get("region"),
                "sourceCandidateId": crop_spec.get("sourceCandidateId"),
                "sourceCandidateType": crop_spec.get("sourceCandidateType"),
                "sourceCategory": crop_spec.get("sourceCategory"),
                "cropIndex": crop_index,
            },
            "sourceModel": "tesseract",
            "modelVersion": availability.tesseract.get("version"),
            "pytesseractVersion": availability.pytesseract.get("version"),
            "tool": OCR_SOURCE,
            "reviewRequired": True,
            "nonAuthoritative": True,
        }
        candidate = {
            "surveyId": survey_id,
            "fileId": file_id,
            "fileUrl": file_url,
            "filename": filename,
            "toolName": OCR_TOOL_NAME,
            "toolVersion": OCR_TOOL_VERSION,
            "candidateType": "ocr_text",
            "candidateCategory": "electrical_context",
            "category": "equipment_label_text_candidate",
            "confidence": confidence,
            "summary": f"Tesseract OCR review candidate: {text[:80]}",
            "payload": payload,
            "bbox": bbox,
            "region": bbox,
            "sourceModel": "tesseract",
            "modelVersion": availability.tesseract.get("version"),
            "reviewStatus": "review_required",
            "reviewRequired": True,
            "nonAuthoritative": True,
            "limitations": BASE_OCR_LIMITATIONS,
            "createdAt": created_at,
            "runHash": "pending",
        }
        deterministic_hash = _stable_hash({**candidate, "candidateId": "stable", "deterministicHash": "stable", "createdAt": "stable-created-at", "runHash": "stable"})
        candidate["deterministicHash"] = deterministic_hash
        candidate["candidateId"] = f"ospv_{deterministic_hash[:24]}"
        return candidate
