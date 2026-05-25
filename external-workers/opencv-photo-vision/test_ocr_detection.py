import importlib.util
import shutil
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).parent / "app" / "ocr_detection.py"
spec = importlib.util.spec_from_file_location("ocr_detection", MODULE_PATH)
ocr_detection = importlib.util.module_from_spec(spec)
try:
    assert spec and spec.loader
    spec.loader.exec_module(ocr_detection)
except ModuleNotFoundError as exc:
    ocr_detection = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


@unittest.skipIf(ocr_detection is None, "Docker worker dependencies are not installed in this Python environment")
class OcrDetectionModuleTest(unittest.TestCase):
    def test_clean_text_and_equipment_hints(self):
        text = ocr_detection.clean_text("  MAIN\nPANEL   200 AMP   MODEL: QO-200  ")
        self.assertEqual(text, "MAIN PANEL 200 AMP MODEL: QO-200")
        hints = ocr_detection.equipment_hints(text)
        kinds = {hint["kind"] for hint in hints}
        self.assertIn("breaker_rating_candidate", kinds)
        self.assertIn("main_service_panel_label_candidate", kinds)
        self.assertIn("manufacturer_model_candidate", kinds)

    def test_unavailable_when_tesseract_binary_missing(self):
        service = ocr_detection.TesseractOcrService()
        service._availability = None
        with mock.patch.object(shutil, "which", return_value=None):
            availability = service.availability()
        self.assertFalse(availability.tesseract["available"])
        self.assertIn("tesseract", service.availability_string())

    def test_detect_emits_no_fake_candidates_when_unavailable(self):
        service = ocr_detection.TesseractOcrService()
        service._availability = ocr_detection.OcrAvailability(
            tesseract={"available": False, "reason": "tesseract_binary_not_found"},
            pytesseract={"available": True, "version": "0.3.13"},
        )
        result = service.detect(
            image=mock.Mock(),
            survey_id="survey-1",
            file_id="file-1",
            file_url="https://example.test/panel.jpg",
            filename="panel.jpg",
            byte_hash="abc123",
            created_at="2026-01-01T00:00:00Z",
            yolo_candidates=[],
        )
        self.assertFalse(result["available"])
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["diagnostic"], "tesseract_binary_not_found")


if __name__ == "__main__":
    unittest.main()
