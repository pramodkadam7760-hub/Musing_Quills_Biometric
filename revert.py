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
                        # remove the literal quotes if they are wrapped, wait tool arguments in transcript are usually unescaped objects or strings.
                        args = tool.get("args", {})
                        if isinstance(args, str):
                            args = json.loads(args)
                        if "TargetFile" in args:
                            edits.append(args)
        except Exception as e:
            pass

for edit in reversed(edits):
    target_file = edit.get("TargetFile")
    target_file = target_file.strip('"') # cleanup just in case
    print("Reverting edit in", target_file)
    try:
        if "TargetContent" in edit and "ReplacementContent" in edit:
            with open(target_file, "r") as f:
                content = f.read()
            if edit["ReplacementContent"] in content:
                content = content.replace(edit["ReplacementContent"], edit["TargetContent"])
                with open(target_file, "w") as f:
                    f.write(content)
                print("  -> Success")
            else:
                print("  -> Failed to find ReplacementContent")
        elif "ReplacementChunks" in edit:
            with open(target_file, "r") as f:
                content = f.read()
            success = False
            for chunk in edit["ReplacementChunks"]:
                if chunk["ReplacementContent"] in content:
                    content = content.replace(chunk["ReplacementContent"], chunk["TargetContent"])
                    success = True
            if success:
                with open(target_file, "w") as f:
                    f.write(content)
                print("  -> Success (multi)")
            else:
                print("  -> Failed to find multi ReplacementContent")
    except Exception as e:
        print("  -> Error:", e)

