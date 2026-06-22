import pytest
import numpy as np
from PIL import Image
from services.preprocessing import ImagePreprocessor
import metrics
from unittest.mock import patch, MagicMock


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

    @patch('metrics.PIPELINE_STEP_LATENCY.labels')
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
        
        mock_labels.assert_called_with(step_name='preprocess')
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
