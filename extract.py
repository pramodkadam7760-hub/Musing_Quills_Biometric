import json

log_file = "/Users/pramodkadam/.gemini/antigravity-ide/brain/999a9429-834b-4718-9c0a-d2607dfadd9b/.system_generated/logs/transcript.jsonl"
edits = []

with open(log_file, "r") as f:
    for line in f:
        try:
            step = json.loads(line)
            if step.get("step_index", 0) >= 380 and "tool_calls" in step:
                for tool in step["tool_calls"]:
                    if tool["name"] in ["replace_file_content", "multi_replace_file_content"]:
                        args = tool.get("args", {})
                        if isinstance(args, str):
                            args = json.loads(args)
                        
                        target = args.get("TargetFile").strip("\"")
                        if target:
                            if "TargetContent" in args:
                                edits.append((target, args["TargetContent"], args["ReplacementContent"]))
                            elif "ReplacementChunks" in args:
                                for chunk in args["ReplacementChunks"]:
                                    edits.append((target, chunk["TargetContent"], chunk["ReplacementContent"]))
        except Exception as e:
            pass

# Process in reverse to restore original content!
for target, old_val, new_val in reversed(edits):
    print("Reverting:", target)
    try:
        with open(target, "r") as f:
            content = f.read()
        if new_val in content:
            content = content.replace(new_val, old_val)
            with open(target, "w") as f:
                f.write(content)
            print("  -> Success")
        else:
            print("  -> Could not find new_val in content")
    except Exception as e:
        print("  -> Error:", e)

