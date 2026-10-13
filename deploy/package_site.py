"""Package only the five public website files for static VPS hosting."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

project = Path(__file__).resolve().parent.parent
files = ["index.html", "app.mjs", "dashboard.mjs", "supabase/config.mjs", "supabase/store.mjs"]
for name in files:
    if not (project / name).is_file():
        raise SystemExit(f"Missing website file: {name}")

output = project / "deploy" / "tcsmonitor-site.zip"
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(project / name, arcname=name)

with ZipFile(output) as archive:
    if set(archive.namelist()) != set(files) or archive.testzip() is not None:
        raise SystemExit("Deployment archive validation failed")
    for name in files:
        if archive.read(name) != (project / name).read_bytes():
            raise SystemExit(f"Archive content mismatch: {name}")

print(f"Ready: {output} ({len(files)} website files)")
