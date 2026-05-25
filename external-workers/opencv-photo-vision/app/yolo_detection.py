from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

YOLO_TOOL_NAME = "yolo"
DEFAULT_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8n.pt")
DEFAULT_CONFIDENCE = float(os.environ.get("YOLO_CONFIDENCE_THRESHOLD", "0.35"))
DEFAULT_IMAGE_SIZE = int(os.environ.get("YOLO_IMAGE_SIZE", "640"))
DEFAULT_MAX_DETECTIONS = int(os.environ.get("YOLO_MAX_DETECTIONS", "24"))
DEFAULT_DEVICE = os.environ.get("YOLO_DEVICE", "cpu")
YOLO_ENABLED = os.environ.get("YOLO_ENABLED", "true").lower() not in {"0", "false", "no", "off"}

UTILITY_CLASS_MAP: dict[str, tuple[str, str, list[str]]] = {
    "tv": ("main_service_panel_candidate", "electrical_context", ["Generic COCO class 'tv' is only a rectangular wall-mounted equipment cue; it is not authoritative MSP identification."]),
    "refrigerator": ("main_service_panel_candidate", "electrical_context", ["Generic COCO class 'refrigerator' is only a tall rectangular equipment cue; it is not authoritative MSP identification."]),
    "microwave": ("disconnect_candidate", "electrical_context", ["Generic COCO class 'microwave' is only a small box-like equipment cue; it is not authoritative disconnect identification."]),
    "oven": ("disconnect_candidate", "electrical_context", ["Generic COCO class 'oven' is only a box-like equipment cue; it is not authoritative disconnect identification."]),
    "traffic light": ("utility_meter_candidate", "electrical_context", ["Generic COCO class 'traffic light' is only a round/box utility-equipment cue; it is not authoritative utility meter identification."]),
    "clock": ("utility_meter_candidate", "electrical_context", ["Generic COCO class 'clock' is only a round-face cue; it is not authoritative utility meter identification."]),
    "bottle": ("roof_vent_candidate", "roof_context", ["Generic COCO class 'bottle' is only a vertical protrusion cue; it is not authoritative roof vent identification."]),
    "vase": ("roof_vent_candidate", "roof_context", ["Generic COCO class 'vase' is only a protrusion cue; it is not authoritative roof vent identification."]),
    "potted plant": ("obstruction_candidate", "field_context", ["Generic COCO class 'potted plant' is only an obstruction cue; it is not authoritative roof obstruction mapping."]),
    "chair": ("obstruction_candidate", "field_context", ["Generic COCO class 'chair' is only an obstruction cue; it is not authoritative roof obstruction mapping."]),
    "bench": ("obstruction_candidate", "field_context", ["Generic COCO class 'bench' is only an obstruction cue; it is not authoritative roof obstruction mapping."]),
    "skis": ("solar_array_candidate", "roof_context", ["Generic COCO class 'skis' is only a long-rectangle visual cue; it is not authoritative solar array detection."]),
    "surfboard": ("solar_array_candidate", "roof_context", ["Generic COCO class 'surfboard' is only a long-rectangle visual cue; it is not authoritative solar array detection."]),
    "cell phone": ("battery_wall_candidate", "electrical_context", ["Generic COCO class 'cell phone' is only a compact rectangle cue; it is not authoritative battery identification."]),
}

TARGET_CLASS_NAMES = [
    "utility_meter",
    "main_service_panel",
    "disconnect",
    "roof_vent",
    "chimney",
    "skylight",
    "obstruction",
    "roof_edge_candidate",
    "solar_array_candidate",
    "battery_wall_candidate",
]

CUSTOM_CLASS_MAP: dict[str, tuple[str, str, list[str]]] = {
    "utility_meter": ("utility_meter_candidate", "electrical_context", []),
    "main_service_panel": ("main_service_panel_candidate", "electrical_context", []),
    "msp": ("main_service_panel_candidate", "electrical_context", []),
    "disconnect": ("disconnect_candidate", "electrical_context", []),
    "roof_vent": ("roof_vent_candidate", "roof_context", []),
    "chimney": ("chimney_candidate", "roof_context", []),
    "skylight": ("skylight_candidate", "roof_context", []),
    "obstruction": ("obstruction_candidate", "field_context", []),
    "roof_edge": ("roof_edge_candidate", "roof_context", ["YOLO box is a semantic cue only; it is not a measured roof edge or CAD boundary."]),
    "roof_edge_candidate": ("roof_edge_candidate", "roof_context", ["YOLO box is a semantic cue only; it is not a measured roof edge or CAD boundary."]),
    "solar_array": ("solar_array_candidate", "roof_context", []),
    "solar_array_candidate": ("solar_array_candidate", "roof_context", []),
    "battery": ("battery_wall_candidate", "electrical_context", []),
    "battery_wall_candidate": ("battery_wall_candidate", "electrical_context", []),
}

BASE_DETECTION_LIMITATIONS = [
    "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
    "YOLO detections are semantic review cues from model inference and cannot create roof planes, CAD geometry, permit inputs, BOM inputs, or engineering truth.",
    "SolarPro must persist and review detections; this external worker does not write to the SolarPro database.",
]

@dataclass
class DetectionAvailability:
    yolo: dict[str, Any]
    supervision: dict[str, Any]


class YoloDetectionService:
    def __init__(self) -> None:
        self.enabled = YOLO_ENABLED
        self.model_path = DEFAULT_MODEL_PATH
        self.confidence_threshold = DEFAULT_CONFIDENCE
        self.image_size = DEFAULT_IMAGE_SIZE
        self.max_detections = DEFAULT_MAX_DETECTIONS
        self.device = DEFAULT_DEVICE
        self.model: Any | None = None
        self.model_names: dict[int, str] = {}
        self.load_error: str | None = None
        self.ultralytics_version: str | None = None
        self.supervision_version: str | None = None
        self._supervision_available = False
        self._load_once()

    def _load_once(self) -> None:
        if not self.enabled:
            self.load_error = "yolo_disabled_by_environment"
            return
        try:
            import supervision as sv  # type: ignore
            self.supervision_version = getattr(sv, "__version__", "unknown")
            self._supervision_available = True
        except Exception as exc:  # pragma: no cover - depends on installed optional package
            self._supervision_available = False
            self.supervision_version = None
            self.load_error = f"supervision_import_failed:{str(exc)[:160]}"
            return
        try:
            import ultralytics  # type: ignore
            from ultralytics import YOLO  # type: ignore
            self.ultralytics_version = getattr(ultralytics, "__version__", "unknown")
            self.model = YOLO(self.model_path)
            names = getattr(self.model, "names", {}) or {}
            self.model_names = {int(k): str(v) for k, v in dict(names).items()}
        except Exception as exc:  # pragma: no cover - depends on weights/network/runtime
            self.model = None
            self.load_error = f"yolo_model_load_failed:{str(exc)[:180]}"

    def availability(self) -> DetectionAvailability:
        model_loaded = self.model is not None
        reason = None if model_loaded else (self.load_error or "model_not_loaded")
        return DetectionAvailability(
            yolo={
                "available": bool(self.enabled and model_loaded),
                "reason": reason,
                "modelLoaded": model_loaded,
                "model": self.model_path,
                "modelVersion": self.ultralytics_version,
                "device": self.device,
                "confidenceThreshold": self.confidence_threshold,
                "imageSize": self.image_size,
                "maxDetections": self.max_detections,
                "targetClasses": TARGET_CLASS_NAMES,
                "customSolarWeights": self._has_custom_solar_weights(),
            },
            supervision={
                "available": self._supervision_available,
                "reason": None if self._supervision_available else (self.load_error or "supervision_not_loaded"),
                "version": self.supervision_version,
            },
        )

    def is_available(self) -> bool:
        return bool(self.enabled and self.model is not None and self._supervision_available)

    def detect(self, image_bgr: np.ndarray, *, survey_id: str, file_id: str, file_url: str, filename: str | None, byte_hash: str, created_at: str) -> dict[str, Any]:
        started = time.time()
        availability = self.availability()
        if not self.is_available():
            return {
                "available": False,
                "diagnostic": availability.yolo.get("reason") or "yolo_unavailable",
                "candidates": [],
                "elapsedMs": 0,
                "model": self.model_path,
                "modelVersion": self.ultralytics_version,
                "limitations": ["YOLO/Supervision unavailable; no semantic object detections emitted.", *BASE_DETECTION_LIMITATIONS],
            }

        height, width = image_bgr.shape[:2]
        results = self.model.predict(
            source=image_bgr,
            conf=self.confidence_threshold,
            imgsz=self.image_size,
            device=self.device,
            verbose=False,
            max_det=self.max_detections,
        )
        candidates: list[dict[str, Any]] = []
        first = results[0] if results else None
        boxes = getattr(first, "boxes", None)
        if boxes is not None:
            xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else np.asarray(boxes.xyxy)
            confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else np.asarray(boxes.conf)
            classes = boxes.cls.cpu().numpy().astype(int) if hasattr(boxes.cls, "cpu") else np.asarray(boxes.cls).astype(int)
            for index, (box, conf, class_id) in enumerate(zip(xyxy, confs, classes)):
                class_name = self.model_names.get(int(class_id), str(class_id))
                mapped = self._map_class(class_name)
                if mapped is None:
                    continue
                candidate_type, category, mapping_limitations = mapped
                x1, y1, x2, y2 = [float(v) for v in box]
                region = normalize_box(x1, y1, x2, y2, width, height)
                model_kind_limitations = [] if self._has_custom_solar_weights() else [
                    "Generic pretrained YOLO weights are not solar-specific; class mapping is conservative and may be wrong.",
                    f"Raw model class was '{class_name}', mapped to '{candidate_type}' only as a probable review cue.",
                ]
                confidence = int(max(1, min(99, round(float(conf) * 100))))
                payload = {
                    "source": "yolo_detection",
                    "sourceImageSha256": byte_hash,
                    "sourceModel": self.model_path,
                    "modelVersion": self.ultralytics_version,
                    "supervisionVersion": self.supervision_version,
                    "rawClassName": class_name,
                    "rawClassId": int(class_id),
                    "bbox": region,
                    "region": region,
                    "tool": YOLO_TOOL_NAME,
                    "reviewRequired": True,
                    "nonAuthoritative": True,
                }
                candidates.append({
                    "surveyId": survey_id,
                    "fileId": file_id,
                    "fileUrl": file_url,
                    "filename": filename,
                    "toolName": "external-yolo-supervision-worker",
                    "toolVersion": self.ultralytics_version or "unknown",
                    "runHash": "pending",
                    "reviewStatus": "review_required",
                    "nonAuthoritative": True,
                    "createdAt": created_at,
                    "candidateId": "pending",
                    "deterministicHash": "pending",
                    "candidateType": "object_detection",
                    "candidateCategory": category,
                    "category": candidate_type,
                    "confidence": confidence,
                    "summary": self._summary(candidate_type, class_name, confidence),
                    "payload": payload,
                    "bbox": region,
                    "region": region,
                    "sourceModel": self.model_path,
                    "modelVersion": self.ultralytics_version,
                    "reviewRequired": True,
                    "limitations": [*mapping_limitations, *model_kind_limitations, *BASE_DETECTION_LIMITATIONS],
                })
        return {
            "available": True,
            "diagnostic": None,
            "candidates": candidates[: self.max_detections],
            "elapsedMs": int((time.time() - started) * 1000),
            "model": self.model_path,
            "modelVersion": self.ultralytics_version,
            "limitations": BASE_DETECTION_LIMITATIONS,
        }

    def _has_custom_solar_weights(self) -> bool:
        name = os.path.basename(self.model_path).lower()
        return any(token in name for token in ["solar", "roof", "msp", "utility", "battery"])

    def _map_class(self, class_name: str) -> tuple[str, str, list[str]] | None:
        normalized = class_name.strip().lower().replace("-", "_")
        if normalized in CUSTOM_CLASS_MAP:
            return CUSTOM_CLASS_MAP[normalized]
        generic_key = class_name.strip().lower()
        return UTILITY_CLASS_MAP.get(generic_key)

    def _summary(self, candidate_type: str, raw_class: str, confidence: int) -> str:
        label = candidate_type.replace("_", " ")
        return f"YOLO/Supervision semantic {label}; raw class '{raw_class}', confidence {confidence}/100. Review required; not authoritative."


def normalize_box(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> dict[str, Any]:
    left = max(0.0, min(x1, x2))
    top = max(0.0, min(y1, y2))
    right = min(float(width), max(x1, x2))
    bottom = min(float(height), max(y1, y2))
    return {
        "x": int(round(left / max(1, width) * 1000)),
        "y": int(round(top / max(1, height) * 1000)),
        "width": int(round(max(1.0, right - left) / max(1, width) * 1000)),
        "height": int(round(max(1.0, bottom - top) / max(1, height) * 1000)),
        "coordinateSystem": "normalized_image_0_1000",
    }
