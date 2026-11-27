#!/usr/bin/env python3
"""Strict data-only SCALE Shadow Replay runner protocol v1."""
import argparse
import json
import re
import sys
from pathlib import Path

MAX_DOCUMENT = 1024 * 1024
MAX_EVENTS = 500
MAX_RULES = 500
MAX_INPUT = 64 * 1024
DECISIONS = {"allow", "warn", "block"}


class ProtocolError(ValueError):
    pass


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_document(path, label):
    data = Path(path).read_bytes()
    if len(data) > MAX_DOCUMENT:
        raise ProtocolError(f"{label} exceeds the 1 MiB document limit")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"{label} must be valid UTF-8 JSON") from exc


def exact_object(value, keys, label):
    if not isinstance(value, dict):
        raise ProtocolError(f"{label} must be an object")
    unknown = set(value) - set(keys)
    missing = set(keys) - set(value)
    if unknown:
        raise ProtocolError(f"{label} contains unsupported field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise ProtocolError(f"{label} is missing field(s): {', '.join(sorted(missing))}")
    return value


def text(value, label, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ProtocolError(f"{label} must be a non-empty string of at most {maximum} characters")
    return value


def decision(value, label):
    if not isinstance(value, str) or value not in DECISIONS:
        raise ProtocolError(f"{label} must be allow, warn, or block")
    return value


def parse_scenario(raw):
    root = exact_object(raw, ("protocolVersion", "kind", "scenarioId", "sourceCommitSha", "events"), "scenario")
    if type(root["protocolVersion"]) is not int or root["protocolVersion"] != 1 or root["kind"] != "scale-shadow-replay-scenario":
        raise ProtocolError("unsupported scenario protocolVersion/kind")
    scenario_id = text(root["scenarioId"], "scenarioId", 128)
    source = text(root["sourceCommitSha"], "sourceCommitSha", 64)
    if not re.fullmatch(r"[a-fA-F0-9]{40,64}", source):
        raise ProtocolError("sourceCommitSha must be a Git commit SHA")
    events = root["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= MAX_EVENTS:
        raise ProtocolError(f"events must contain 1-{MAX_EVENTS} entries")
    seen = set()
    parsed = []
    for index, value in enumerate(events):
        label = f"events[{index}]"
        row = exact_object(value, ("id", "tool", "input", "expectedDecision"), label)
        event_id = text(row["id"], label + ".id", 128)
        if event_id in seen:
            raise ProtocolError(f"duplicate event id: {event_id}")
        seen.add(event_id)
        tool = text(row["tool"], label + ".tool", 64)
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9._-]*", tool):
            raise ProtocolError(label + ".tool has invalid characters")
        event_input = text(row["input"], label + ".input", MAX_INPUT)
        if len(event_input.encode("utf-8")) > MAX_INPUT:
            raise ProtocolError(label + ".input exceeds 64 KiB")
        parsed.append({"id": event_id, "tool": tool, "input": event_input,
                       "expectedDecision": decision(row["expectedDecision"], label + ".expectedDecision")})
    return {"scenarioId": scenario_id, "sourceCommitSha": source, "events": parsed}


def parse_candidate(raw):
    root = exact_object(raw, ("protocolVersion", "kind", "candidateId", "failureId", "defaultDecision", "rules"), "candidate")
    if type(root["protocolVersion"]) is not int or root["protocolVersion"] != 1 or root["kind"] != "scale-shadow-replay-candidate":
        raise ProtocolError("unsupported candidate protocolVersion/kind")
    candidate_id = text(root["candidateId"], "candidateId", 128)
    failure_id = text(root["failureId"], "failureId", 128)
    default = decision(root["defaultDecision"], "defaultDecision")
    rules = root["rules"]
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise ProtocolError(f"rules must contain 0-{MAX_RULES} entries")
    seen = set()
    parsed = []
    for index, value in enumerate(rules):
        label = f"rules[{index}]"
        row = exact_object(value, ("id", "priority", "tool", "contains", "decision"), label)
        rule_id = text(row["id"], label + ".id", 128)
        if rule_id in seen:
            raise ProtocolError(f"duplicate rule id: {rule_id}")
        seen.add(rule_id)
        priority = row["priority"]
        if isinstance(priority, bool) or not isinstance(priority, int) or not -1000 <= priority <= 1000:
            raise ProtocolError(label + ".priority must be an integer from -1000 to 1000")
        tool = text(row["tool"], label + ".tool", 64)
        if tool != "*" and not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9._-]*", tool):
            raise ProtocolError(label + ".tool has invalid characters")
        contains = text(row["contains"], label + ".contains", 4096)
        parsed.append({"id": rule_id, "priority": priority, "tool": tool, "contains": contains,
                       "decision": decision(row["decision"], label + ".decision")})
    return {"candidateId": candidate_id, "failureId": failure_id, "defaultDecision": default, "rules": parsed}


def evaluate(scenario, candidate):
    ordered = sorted(candidate["rules"], key=lambda item: (-item["priority"], item["id"]))
    mismatches = []
    matched_count = 0
    for event in scenario["events"]:
        match = next((rule for rule in ordered
                      if (rule["tool"] == "*" or rule["tool"] == event["tool"])
                      and rule["contains"] in event["input"]), None)
        if match:
            matched_count += 1
        actual = match["decision"] if match else candidate["defaultDecision"]
        if actual != event["expectedDecision"]:
            mismatches.append({"eventId": event["id"], "expectedDecision": event["expectedDecision"],
                               "actualDecision": actual, "matchedRuleId": match["id"] if match else None})
    return {"protocolVersion": 1, "scenarioId": scenario["scenarioId"],
            "candidateId": candidate["candidateId"], "failureId": candidate["failureId"],
            "passed": not mismatches, "eventCount": len(scenario["events"]),
            "matchedRuleCount": matched_count, "mismatchCount": len(mismatches), "mismatches": mismatches}


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--candidate", required=True)
    args = parser.parse_args()
    try:
        scenario = parse_scenario(load_document(args.scenario, "scenario snapshot"))
        candidate = parse_candidate(load_document(args.candidate, "candidate bundle"))
        result = evaluate(scenario, candidate)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
        return 0 if result["passed"] else 10
    except (ProtocolError, OSError, RecursionError) as exc:
        print(json.dumps({"protocolVersion": 1, "error": str(exc)}, separators=(",", ":")), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
