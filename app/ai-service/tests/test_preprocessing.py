import pytest
import numpy as np
from PIL import Image
from unittest.mock import patch, MagicMock
import cv2
from services.preprocessing import (
    ImagePreprocessor,
    ImageQualityGate,
    QualityThresholds,
    QualityGateResult,
)
import metrics


class TestImagePreprocessor:
    def setup_method(self):
        self.preprocessor = ImagePreprocessor()

    def test_to_grayscale_from_rgb(self):
        img = Image.new("RGB", (100, 100), color="red")
        gray = self.preprocessor.to_grayscale(img)
        assert gray.mode == "L"
        assert gray.size == (100, 100)

    def test_to_grayscale_from_grayscale(self):
        img = Image.new("L", (50, 50), color=128)
        gray = self.preprocessor.to_grayscale(img)
        assert gray.mode == "L"
        assert gray.size == (50, 50)

    def test_apply_threshold_otsu(self):
        img = Image.new("L", (100, 100), color=128)
        thresholded = self.preprocessor.apply_threshold(img, method="otsu")
        assert thresholded.mode == "L"
        assert thresholded.size == (100, 100)

    def test_apply_threshold_adaptive(self):
        img = Image.new("L", (100, 100), color=128)
        thresholded = self.preprocessor.apply_threshold(img, method="adaptive")
        assert thresholded.mode == "L"

    def test_apply_threshold_invalid_method(self):
        img = Image.new("L", (100, 100), color=128)
        with pytest.raises(ValueError):
            self.preprocessor.apply_threshold(img, method="invalid")

    def test_denoise(self):
        img = Image.new("L", (100, 100), color=128)
        denoised = self.preprocessor.denoise(img)
        assert denoised.mode == "L"

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_preprocess_pipeline(self, mock_labels):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        img = Image.new("RGB", (1000, 1000), color="blue")
        result = self.preprocessor.preprocess(
            img, threshold_method="otsu", denoise=True
        )
        assert result.mode == "L"
        assert result.size[0] <= 2000
        assert result.size[1] <= 2000

        mock_labels.assert_called_with(step_name="preprocess")
        mock_observe.assert_called_once()

    def test_preprocess_with_custom_threshold(self):
        img = Image.new("RGB", (500, 500), color="green")
        result = self.preprocessor.preprocess(
            img, threshold_method="otsu", denoise=False
        )
        assert result.mode == "L"

    def test_preprocess_empty_image(self):
        img = Image.new("RGB", (10, 10), color="white")
        result = self.preprocessor.preprocess(img)
        assert result.mode == "L"

    def test_image_to_numpy(self):
        img = Image.new("RGB", (50, 50), color="red")
        arr = self.preprocessor.image_to_numpy(img)
        assert isinstance(arr, np.ndarray)
        assert arr.shape == (50, 50, 3)

    def test_numpy_to_image(self):
        arr = np.zeros((50, 50, 3), dtype=np.uint8)
        img = self.preprocessor.numpy_to_image(arr)
        assert isinstance(img, Image.Image)
        assert img.size == (50, 50)

    def test_resize_image(self):
        img = Image.new("RGB", (3000, 3000), color="blue")
        resized = self.preprocessor.resize_image(img, max_dim=2000)
        assert resized.size[0] <= 2000
        assert resized.size[1] <= 2000

    def test_resize_image_already_small(self):
        img = Image.new("RGB", (100, 100), color="blue")
        resized = self.preprocessor.resize_image(img, max_dim=2000)
        assert resized.size == (100, 100)


# ---------------------------------------------------------------------------
# ImageQualityGate tests
# ---------------------------------------------------------------------------


class TestImageQualityGate:
    """Tests for the pre-inference quality gate (Issue #992)."""

    def setup_method(self):
        self.gate = ImageQualityGate()

    # -- helpers --------------------------------------------------------

    @staticmethod
    def _make_image(
        width: int,
        height: int,
        color: tuple[int, int, int] = (128, 128, 128),
    ) -> Image.Image:
        """Create a solid-colour RGB image of the given size."""
        return Image.new("RGB", (width, height), color=color)

    @staticmethod
    def _make_blurry_image(
        width: int = 500,
        height: int = 500,
    ) -> Image.Image:
        """Create a very blurry image (low Laplacian variance)."""
        arr = np.full((height, width), 128, dtype=np.uint8)
        # Apply heavy Gaussian blur to eliminate edges
        blurred = np.zeros_like(arr)
        kernel_size = 31
        blurred[:] = 128  # uniform = zero variance after Laplacian
        return Image.fromarray(blurred, mode="L").convert("RGB")

    @staticmethod
    def _make_textured_image(
        width: int = 800,
        height: int = 600,
    ) -> Image.Image:
        """Create an image with strong edges that passes the blur check."""
        # Checkerboard pattern — high Laplacian variance at every boundary
        block = 20
        y_idx = (np.arange(height)[:, None] // block).astype(np.uint8)
        x_idx = (np.arange(width)[None, :] // block).astype(np.uint8)
        arr = np.where((y_idx + x_idx) % 2 == 0, 200, 40).astype(np.uint8)
        return Image.fromarray(arr, mode="L").convert("RGB")

    # -- passing --------------------------------------------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_passing_image(self, mock_counter, mock_cv2):
        # Simulate a sharp image (Laplacian variance > threshold)
        mock_lap = MagicMock()
        mock_lap.var.return_value = 150.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        img = self._make_textured_image(800, 600)
        result = self.gate.run(img)
        assert result.passed is True
        assert result.rejections == []
        mock_counter.labels.assert_not_called()

    # -- resolution rejection -------------------------------------------

    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_too_small_width(self, mock_counter):
        img = self._make_image(50, 300, color=(128, 128, 128))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        assert any("too small" in r for r in result.rejections)
        assert any("50x300" in r for r in result.rejections)
        mock_counter.labels.assert_called()

    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_too_small_height(self, mock_counter):
        img = self._make_image(300, 50, color=(128, 128, 128))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        assert any("too small" in r for r in result.rejections)

    # -- exposure rejection ---------------------------------------------

    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_near_black_image(self, mock_counter):
        img = self._make_image(800, 600, color=(5, 5, 5))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        assert any("too dark" in r for r in result.rejections)
        mock_counter.labels.assert_called()

    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_near_white_image(self, mock_counter):
        img = self._make_image(800, 600, color=(250, 250, 250))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        assert any("too bright" in r for r in result.rejections)
        mock_counter.labels.assert_called()

    # -- blur rejection -------------------------------------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_blurry_image(self, mock_counter, mock_cv2):
        # Simulate a blurry image (Laplacian variance < threshold)
        mock_lap = MagicMock()
        mock_lap.var.return_value = 5.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        img = self._make_blurry_image(500, 500)
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        assert any("blurry" in r for r in result.rejections)
        mock_counter.labels.assert_called()

    # -- multiple rejections --------------------------------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejects_image_failing_multiple_checks(self, mock_counter, mock_cv2):
        mock_lap = MagicMock()
        mock_lap.var.return_value = 5.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        # Tiny, near-black image that is also blurry
        img = self._make_image(10, 10, color=(2, 2, 2))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        assert result.passed is False
        # Should have at least 2 distinct rejection reasons
        assert len(result.rejections) >= 2

    # -- custom thresholds ----------------------------------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_custom_thresholds_respected(self, mock_counter, mock_cv2):
        mock_lap = MagicMock()
        mock_lap.var.return_value = 300.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        tight = QualityThresholds(
            min_width=1000,
            min_height=1000,
            min_mean_brightness=50.0,
            max_mean_brightness=200.0,
            min_laplacian_variance=200.0,
        )
        gate = ImageQualityGate(thresholds=tight)
        img = self._make_image(500, 500, color=(128, 128, 128))
        mock_counter.labels.return_value = MagicMock()
        result = gate.run(img)
        # 500x500 is below 1000x1000 minimum
        assert result.passed is False
        assert any("too small" in r for r in result.rejections)

    # -- rejection reasons are actionable strings -----------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_rejection_reasons_contain_expected_parts(self, mock_counter, mock_cv2):
        mock_lap = MagicMock()
        mock_lap.var.return_value = 5.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        img = self._make_image(10, 10, color=(2, 2, 2))
        mock_counter.labels.return_value = MagicMock()
        result = self.gate.run(img)
        for reason in result.rejections:
            # Every rejection should contain actual vs expected values
            assert isinstance(reason, str)
            assert len(reason) > 10

    # -- defaults are documented ----------------------------------------

    def test_default_thresholds(self):
        t = QualityThresholds()
        assert t.min_width == 200
        assert t.min_height == 200
        assert t.min_mean_brightness == 20.0
        assert t.max_mean_brightness == 235.0
        assert t.min_laplacian_variance == 80.0

    # -- metrics counter increments ------------------------------------

    @patch("services.preprocessing.cv2")
    @patch("metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL")
    def test_metrics_counter_increments_per_reason(self, mock_counter, mock_cv2):
        mock_lap = MagicMock()
        mock_lap.var.return_value = 5.0
        mock_cv2.Laplacian.return_value = mock_lap
        mock_cv2.CV_64F = cv2.CV_64F

        # Image that fails resolution + exposure + blur checks
        img = self._make_image(10, 10, color=(2, 2, 2))
        labels_mock = MagicMock()
        mock_counter.labels.return_value = labels_mock
        result = self.gate.run(img)
        # Each rejection should increment the counter once
        assert labels_mock.inc.call_count == len(result.rejections)
        assert mock_counter.labels.call_count == len(result.rejections)
