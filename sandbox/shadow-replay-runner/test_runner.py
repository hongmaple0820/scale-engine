import json
import subprocess
import tempfile
import unittest
from pathlib import Path

RUNNER = Path(__file__).with_name("runner.py")


class RunnerProtocolTests(unittest.TestCase):
    def run_case(self, scenario, candidate):
        with tempfile.TemporaryDirectory() as directory:
            scenario_path = Path(directory) / "scenario.json"
            candidate_path = Path(directory) / "candidate.json"
            scenario_path.write_text(json.dumps(scenario), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            return subprocess.run(
                ["python3", str(RUNNER), "--scenario", str(scenario_path), "--candidate", str(candidate_path)],
                capture_output=True, text=True, check=False,
            )

    def base(self):
        scenario = {"protocolVersion": 1, "kind": "scale-shadow-replay-scenario",
                    "scenarioId": "scenario-1", "sourceCommitSha": "a" * 40,
                    "events": [{"id": "event-1", "tool": "fs.write", "input": "write /tmp/a",
                                "expectedDecision": "block"}]}
        candidate = {"protocolVersion": 1, "kind": "scale-shadow-replay-candidate",
                     "candidateId": "candidate-1", "failureId": "failure-1",
                     "defaultDecision": "allow",
                     "rules": [{"id": "block-write", "priority": 10, "tool": "fs.write",
                                "contains": "write", "decision": "block"}]}
        return scenario, candidate

    def test_matching_rule_passes_and_does_not_echo_input(self):
        scenario, candidate = self.base()
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)
        self.assertTrue(output["passed"])
        self.assertEqual(output["matchedRuleCount"], 1)
        self.assertNotIn("write /tmp/a", result.stdout)

    def test_mismatch_returns_exit_10_and_structured_result(self):
        scenario, candidate = self.base()
        candidate["rules"] = []
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 10)
        self.assertEqual(json.loads(result.stdout)["mismatchCount"], 1)

    def test_unknown_command_field_is_rejected(self):
        scenario, candidate = self.base()
        candidate["command"] = "echo unsafe"
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 2)
        self.assertIn("unsupported field", result.stderr)

    def test_boolean_protocol_version_is_rejected(self):
        scenario, candidate = self.base()
        scenario["protocolVersion"] = True
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 2)
        self.assertIn("unsupported scenario", result.stderr)

    def test_non_string_decision_is_rejected_without_traceback(self):
        scenario, candidate = self.base()
        candidate["defaultDecision"] = []
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be allow, warn, or block", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


    def test_string_limits_match_javascript_utf16_code_units(self):
        scenario, candidate = self.base()
        # 65,538 UTF-16 code units must be rejected even though Python sees
        # only 32,769 Unicode code points.
        scenario["events"][0]["input"] = "😀" * 32769
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 2)
        self.assertIn("at most 65536 characters", result.stderr)

    def test_equal_priority_rule_ids_use_javascript_utf16_order(self):
        scenario, candidate = self.base()
        # U+10000 sorts before U+E000 by UTF-16 code units, but after it by
        # Python Unicode code points. The TypeScript contract uses JS '<'.
        candidate["rules"] = [
            {"id": "\uE000", "priority": 10, "tool": "fs.write", "contains": "write", "decision": "warn"},
            {"id": "𐀀", "priority": 10, "tool": "fs.write", "contains": "write", "decision": "block"},
        ]
        result = self.run_case(scenario, candidate)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["mismatches"], [])

    def test_duplicate_json_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            scenario_path = Path(directory) / "scenario.json"
            candidate_path = Path(directory) / "candidate.json"
            scenario_path.write_text('{"protocolVersion":1,"protocolVersion":1}', encoding="utf-8")
            candidate_path.write_text("{}", encoding="utf-8")
            result = subprocess.run(
                ["python3", str(RUNNER), "--scenario", str(scenario_path), "--candidate", str(candidate_path)],
                capture_output=True, text=True, check=False,
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("duplicate JSON key", result.stderr)


if __name__ == "__main__":
    unittest.main()
