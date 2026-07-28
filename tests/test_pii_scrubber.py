import json
import difflib
from scrubber import scrub_pii


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


inputs = load_json("tests/fixtures/pii_inputs.json")
expected = load_json("tests/fixtures/expected_outputs.json")


def test_pii_scrubbing():

    for inp, exp in zip(inputs, expected):

        result = scrub_pii(inp["input"])

        if result != exp["expected"]:

            diff = "\n".join(
                difflib.unified_diff(
                    [exp["expected"]],
                    [result],
                    fromfile="expected",
                    tofile="actual",
                    lineterm=""
                )
            )

            print("\nRegression Detected:")
            print(diff)

        assert result == exp["expected"]
