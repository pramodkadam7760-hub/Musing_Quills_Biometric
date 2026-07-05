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
                        if "TargetFile" in args:
                            edits.append(args)
        except Exception as e:
            pass

# Group by file
files_history = {}
for edit in edits:
    target = edit.get("TargetFile")
    if target not in files_history:
        files_history[target] = []
    files_history[target].append(edit)

for target, history in files_history.items():
    print("--------------------------------------------------")
    print(f"File: {target}")
    # The first edit has the original TargetContent
    first_edit = history[0]
    if "TargetContent" in first_edit:
        print("ORIGINAL TARGET CONTENT (Before first replace):")
        print(first_edit["TargetContent"][:500] + "...\n")
    elif "ReplacementChunks" in first_edit:
        print("ORIGINAL CHUNKS CONTENT:")
        for chunk in first_edit["ReplacementChunks"]:
            print(chunk["TargetContent"][:500] + "...\n")
