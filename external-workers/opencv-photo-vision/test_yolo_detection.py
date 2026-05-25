import importlib.util
import unittest
from pathlib import Path

try:
    import numpy as np
except ModuleNotFoundError:  # Allows repository tests to skip when Docker worker deps are not installed.
    np = None

module_path = Path(__file__).parent / "app" / "yolo_detection.py"
spec = importlib.util.spec_from_file_location("yolo_detection", module_path)
yolo_detection = importlib.util.module_from_spec(spec)
assert spec and spec.loader
try:
    spec.loader.exec_module(yolo_detection)
except ModuleNotFoundError as exc:
    yolo_detection = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


@unittest.skipIf(yolo_detection is None, "Docker worker dependencies are not installed in this Python environment")
class YoloDetectionModuleTest(unittest.TestCase):
    def test_normalize_box_is_deterministic_normalized_coordinates(self):
        box = yolo_detection.normalize_box(10, 20, 110, 220, 200, 400)
        self.assertEqual(box, {
            "x": 50,
            "y": 50,
            "width": 500,
            "height": 500,
            "coordinateSystem": "normalized_image_0_1000",
        })

    @unittest.skipIf(np is None, "numpy worker dependency is not installed outside Docker")
    def test_unavailable_service_emits_no_fabricated_detections(self):
        service = yolo_detection.YoloDetectionService.__new__(yolo_detection.YoloDetectionService)
        service.enabled = True
        service.model_path = "missing-solar-model.pt"
        service.confidence_threshold = 0.35
        service.image_size = 640
        service.max_detections = 24
        service.device = "cpu"
        service.model = None
        service.model_names = {}
        service.load_error = "yolo_model_load_failed:test"
        service.ultralytics_version = None
        service.supervision_version = None
        service._supervision_available = False

        result = service.detect(
            np.zeros((20, 20, 3), dtype=np.uint8),
            survey_id="survey-1",
            file_id="file-1",
            file_url="https://example.test/photo.jpg",
            filename="photo.jpg",
            byte_hash="abc",
            created_at="2026-01-01T00:00:00Z",
        )

        self.assertFalse(result["available"])
        self.assertEqual(result["candidates"], [])
        self.assertIn("yolo_model_load_failed", result["diagnostic"])
        self.assertTrue(any("no semantic object detections emitted" in item for item in result["limitations"]))

    def test_custom_and_generic_class_mapping_are_conservative(self):
        service = yolo_detection.YoloDetectionService.__new__(yolo_detection.YoloDetectionService)
        service.model_path = "yolov8n.pt"
        self.assertEqual(service._map_class("main_service_panel")[0], "main_service_panel_candidate")
        mapped = service._map_class("tv")
        self.assertEqual(mapped[0], "main_service_panel_candidate")
        self.assertIn("not authoritative MSP", mapped[2][0])
        self.assertIsNone(service._map_class("person"))


if __name__ == "__main__":
    unittest.main()
