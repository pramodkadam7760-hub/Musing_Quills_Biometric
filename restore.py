import json

log_file = "/Users/pramodkadam/.gemini/antigravity-ide/brain/999a9429-834b-4718-9c0a-d2607dfadd9b/.system_generated/logs/transcript.jsonl"
reverts = {}

with open(log_file, "r") as f:
    for line in f:
        try:
            step = json.loads(line)
            if step.get("step_index", 0) >= 380 and "tool_calls" in step:
                for tool in step["tool_calls"]:
                    if tool["name"] == "replace_file_content" or tool["name"] == "multi_replace_file_content":
                        args = tool.get("args", {})
                        if args:
                            target_file = args.get("TargetFile")
                            if target_file and target_file not in reverts:
                                # This is the first edit to this file since step 380
                                # So its TargetContent represents the original state of those lines.
                                reverts[target_file] = []
                            
                            if target_file:
                                reverts[target_file].append(args)
        except Exception as e:
            pass

for f, calls in reverts.items():
    print(f"File modified: {f} ({len(calls)} edits)")

