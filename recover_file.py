import json

log_file = "/Users/pramodkadam/.gemini/antigravity-ide/brain/999a9429-834b-4718-9c0a-d2607dfadd9b/.system_generated/logs/transcript.jsonl"
found = False

with open(log_file, "r") as f:
    for line in f:
        try:
            step = json.loads(line)
            if step["type"] == "TOOL_RESPONSE" and "index.html" in step["content"] and "Showing lines" in step["content"]:
                # This is a view_file response!
                content = step["content"]
                lines = content.split('\n')
                restored = []
                for l in lines:
                    if l.startswith("The following code has been modified") or l.startswith("The above content does NOT show") or l.startswith("Created At:") or l.startswith("Completed At:") or l.startswith("File Path:") or l.startswith("Total Lines:") or l.startswith("Total Bytes:") or l.startswith("Showing lines"):
                        continue
                    # Format: 1: <!DOCTYPE html>
                    if ": " in l:
                        parts = l.split(": ", 1)
                        if parts[0].isdigit():
                            restored.append(parts[1])
                        else:
                            restored.append(l)
                    else:
                        if l.strip():
                            restored.append(l)
                
                with open("index.html.original", "w") as out:
                    out.write('\n'.join(restored))
                print("Restored index.html")
                found = True
                break
        except Exception as e:
            pass
