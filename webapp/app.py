from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import json as json_module
from flask import Flask, jsonify, render_template, request, url_for, send_file, abort

from .jobs import Job, JobStore

REQUIRED_INPUT_FILES = ("projects.csv", "resources.json", "config.json")


def _default_projects_root() -> Path:
    return (Path(__file__).resolve().parent.parent / "portfolios").resolve()


def _resolve_projects_root() -> Path:
    env_value = os.getenv("PROJECTS_ROOT")
    if env_value:
        return Path(env_value).expanduser().resolve()
    return _default_projects_root()


def _validate_within_root(path: Path, root: Path) -> None:
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Portfolio directory must be inside {root}") from exc


def _check_input_dir(project_dir: Path) -> Tuple[Path, List[str]]:
    input_dir = project_dir / "input"
    missing: List[str] = []
    if not input_dir.is_dir():
        missing.extend(list(REQUIRED_INPUT_FILES))
        return input_dir, missing
    for name in REQUIRED_INPUT_FILES:
        if not (input_dir / name).is_file():
            missing.append(name)
    return input_dir, missing


def _resolve_project_dir(raw_value: str, root: Path) -> Path:
    if not raw_value:
        raise ValueError("project_dir is required")
    candidate = Path(raw_value).expanduser()
    if candidate.is_absolute():
        project_dir = candidate.resolve()
    else:
        project_dir = (root / candidate).resolve()
    if not project_dir.exists() or not project_dir.is_dir():
        raise ValueError(f"Portfolio directory not found: {project_dir}")
    _validate_within_root(project_dir, root)
    input_dir, missing = _check_input_dir(project_dir)
    if missing:
        missing_list = ", ".join(missing)
        raise ValueError(
            f"Portfolio directory must contain input files at {input_dir}: missing {missing_list}"
        )
    return project_dir


def _list_project_dirs(root: Path) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []
    if not root.exists():
        return entries
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        rel_name = child.relative_to(root).as_posix()
        input_dir, missing = _check_input_dir(child)
        entries.append(
            {
                "name": rel_name,
                "input_dir": input_dir.as_posix(),
                "is_valid": not missing,
            }
        )
    return entries


def _job_to_dict(job: Job) -> Dict[str, object]:
    payload = job.to_dict()
    return payload


def create_app() -> Flask:
    app = Flask(__name__)
    projects_root = _resolve_projects_root()
    job_store = JobStore()
    app.config["PROJECTS_ROOT"] = projects_root
    app.config["JOB_STORE"] = job_store

    @app.get("/")
    def index() -> str:
        jobs = [_job_to_dict(job) for job in job_store.list_jobs()]
        dirs = _list_project_dirs(projects_root)
        public_demo_mode = os.getenv("PUBLIC_DEMO_MODE", "").lower() in ("true", "1", "yes")
        return render_template(
            "index.html",
            jobs=jobs,
            project_dirs=dirs,
            projects_root=projects_root,
            public_demo_mode=public_demo_mode
        )

    @app.get("/dirs")
    def directories():
        dirs = _list_project_dirs(projects_root)
        return jsonify({"projects": dirs})

    @app.post("/run")
    def run_job():
        data = request.get_json(silent=True) or {}
        project_dir_value = data.get("project_dir") or request.form.get("project_dir")
        if project_dir_value is None:
            return jsonify({"error": "project_dir is required"}), 400
        try:
            project_dir = _resolve_project_dir(project_dir_value, projects_root)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        # Run the portfolio scheduler
        scheduler_script = Path(__file__).resolve().parent.parent / "portfolio_scheduler.py"
        cmd = [
            sys.executable,
            str(scheduler_script),
            project_dir.name,  # Pass just the portfolio name
        ]
        job = job_store.create_job(project_dir, cmd)
        job_store.start_job(job)
        status_url = url_for("status_job", job_id=job.id)
        return jsonify({"job_id": job.id, "status_url": status_url}), 202

    @app.get("/status/<job_id>")
    def status_job(job_id: str):
        job = job_store.get_job(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        return jsonify(_job_to_dict(job))

    @app.get("/files/<path:file_path>")
    def serve_file(file_path: str):
        """Serve files from the portfolios directory"""
        file_full_path = projects_root / file_path
        try:
            # Validate the path is within the projects root
            file_full_path = file_full_path.resolve()
            _validate_within_root(file_full_path, projects_root)

            if not file_full_path.exists():
                abort(404)
            if not file_full_path.is_file():
                abort(404)

            return send_file(file_full_path)
        except (ValueError, OSError):
            abort(404)

    @app.get("/api/files/<portfolio_name>")
    def get_file_info(portfolio_name: str):
        """Get file information with modification dates for a portfolio"""
        import datetime
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            if not portfolio_path.exists() or not portfolio_path.is_dir():
                return jsonify({"error": "Portfolio not found"}), 404

            file_info = {
                "input": [],
                "output": []
            }

            # Check input files
            input_dir = portfolio_path / "input"
            if input_dir.exists() and input_dir.is_dir():
                input_files = ["projects.csv", "resources.json", "config.json", "programs.csv"]
                for filename in input_files:
                    file_path = input_dir / filename
                    if file_path.exists() and file_path.is_file():
                        stat = file_path.stat()
                        file_info["input"].append({
                            "name": filename,
                            "path": f"input/{filename}",
                            "modified": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "size": stat.st_size
                        })

            # Check output files
            output_dir = portfolio_path / "output"
            if output_dir.exists() and output_dir.is_dir():
                output_files = ["projects.csv", "bottleneck_analysis.md"]
                for filename in output_files:
                    file_path = output_dir / filename
                    if file_path.exists() and file_path.is_file():
                        stat = file_path.stat()
                        file_info["output"].append({
                            "name": filename,
                            "path": f"output/{filename}",
                            "modified": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "size": stat.st_size
                        })

            return jsonify(file_info)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/resources/<portfolio_name>")
    def get_resources(portfolio_name: str):
        """Get resources.json for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            resources_file = portfolio_path / "input" / "resources.json"
            if not resources_file.exists():
                return jsonify({"error": "resources.json not found"}), 404

            with open(resources_file, 'r') as f:
                resources_data = json_module.load(f)

            return jsonify(resources_data)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/resources/<portfolio_name>")
    def save_resources(portfolio_name: str):
        """Save resources.json for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            resources_data = request.get_json()
            if not isinstance(resources_data, dict):
                return jsonify({"error": "resources data must be an object"}), 400

            resources_file = portfolio_path / "input" / "resources.json"
            resources_file.parent.mkdir(parents=True, exist_ok=True)

            with open(resources_file, 'w') as f:
                json_module.dump(resources_data, f, indent=2)

            return jsonify({"success": True})
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    # Keep old people endpoints for backward compatibility but map to resources
    @app.get("/api/people/<portfolio_name>")
    def get_people(portfolio_name: str):
        """Legacy endpoint - redirects to resources"""
        return get_resources(portfolio_name)

    @app.post("/api/people/<portfolio_name>")
    def save_people(portfolio_name: str):
        """Legacy endpoint - redirects to resources"""
        return save_resources(portfolio_name)

    @app.get("/api/projects/<portfolio_name>")
    def get_projects(portfolio_name: str):
        """Get projects.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            projects_file = portfolio_path / "input" / "projects.csv"
            if not projects_file.exists():
                return jsonify({"error": "projects.csv not found"}), 404

            import csv
            projects_data = []
            with open(projects_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    projects_data.append(row)

            return jsonify(projects_data)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/projects/<portfolio_name>")
    def save_projects(portfolio_name: str):
        """Save projects.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            projects_data = request.get_json()
            if not isinstance(projects_data, list):
                return jsonify({"error": "projects data must be an array"}), 400

            projects_file = portfolio_path / "input" / "projects.csv"
            projects_file.parent.mkdir(parents=True, exist_ok=True)

            # Write CSV with expected columns
            import csv
            if len(projects_data) > 0:
                fieldnames = list(projects_data[0].keys())
                with open(projects_file, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(projects_data)
            else:
                # Create empty file with headers
                with open(projects_file, 'w', newline='') as f:
                    pass

            return jsonify({"success": True})
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/programs/<portfolio_name>")
    def get_programs(portfolio_name: str):
        """Get programs.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            programs_file = portfolio_path / "input" / "programs.csv"
            if not programs_file.exists():
                # Return empty array if file doesn't exist
                return jsonify([])

            import csv
            programs_data = []
            with open(programs_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    programs_data.append(row)

            return jsonify(programs_data)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/programs/<portfolio_name>")
    def save_programs(portfolio_name: str):
        """Save programs.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            programs_data = request.get_json()
            if not isinstance(programs_data, list):
                return jsonify({"error": "programs data must be an array"}), 400

            programs_file = portfolio_path / "input" / "programs.csv"
            programs_file.parent.mkdir(parents=True, exist_ok=True)

            # Write CSV with expected columns
            import csv
            if len(programs_data) > 0:
                fieldnames = ['name', 'color']
                with open(programs_file, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(programs_data)
            else:
                # Create empty file with headers
                fieldnames = ['name', 'color']
                with open(programs_file, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()

            return jsonify({"success": True})
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/config/<portfolio_name>")
    def get_config(portfolio_name: str):
        """Get config.json for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            config_file = portfolio_path / "input" / "config.json"
            if not config_file.exists():
                return jsonify({"error": "config.json not found"}), 404

            with open(config_file, "r") as f:
                config_data = json_module.load(f)

            return jsonify(config_data)
        except (ValueError, OSError, json_module.JSONDecodeError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/config/<portfolio_name>")
    def save_config(portfolio_name: str):
        """Save config.json for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            config_data = request.get_json()
            if not isinstance(config_data, dict):
                return jsonify({"error": "config data must be an object"}), 400

            config_file = portfolio_path / "input" / "config.json"
            config_file.parent.mkdir(parents=True, exist_ok=True)

            with open(config_file, "w") as f:
                json_module.dump(config_data, f, indent=2)

            return jsonify({"success": True})
        except (ValueError, OSError, json_module.JSONDecodeError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/skills/<portfolio_name>")
    def get_skills(portfolio_name: str):
        """Get skills.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            skills_file = portfolio_path / "input" / "skills.csv"
            if not skills_file.exists():
                # Return empty array if file doesn't exist
                return jsonify([])

            import csv
            skills_data = []
            with open(skills_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    skills_data.append(row)

            return jsonify(skills_data)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/skills/<portfolio_name>")
    def save_skills(portfolio_name: str):
        """Save skills.csv for a portfolio"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            skills_data = request.get_json()
            if not isinstance(skills_data, list):
                return jsonify({"error": "skills data must be an array"}), 400

            skills_file = portfolio_path / "input" / "skills.csv"
            skills_file.parent.mkdir(parents=True, exist_ok=True)

            # Write CSV with expected columns
            import csv
            if len(skills_data) > 0:
                fieldnames = ['skill_id', 'name', 'category', 'description']
                with open(skills_file, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(skills_data)
            else:
                # Create empty file with headers
                fieldnames = ['skill_id', 'name', 'category', 'description']
                with open(skills_file, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()

            return jsonify({"success": True})
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/output/projects/<portfolio_name>")
    def get_output_projects(portfolio_name: str):
        """Get scheduled projects.csv from output folder"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            projects_file = portfolio_path / "output" / "projects.csv"
            if not projects_file.exists():
                return jsonify({"error": "Output projects.csv not found. Run the model first."}), 404

            import csv
            projects_data = []
            with open(projects_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    projects_data.append(row)

            return jsonify(projects_data)
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.put("/api/output/projects/<portfolio_name>")
    def update_output_project_dates(portfolio_name: str):
        """Update start_date and end_date for a project in output projects.csv"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            # Get request data
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body is required"}), 400

            project_id = data.get('project_id')
            start_date = data.get('start_date')
            end_date = data.get('end_date')

            if not project_id:
                return jsonify({"error": "project_id is required"}), 400
            if not start_date or not end_date:
                return jsonify({"error": "start_date and end_date are required"}), 400

            # Validate date format (YYYY-MM-DD)
            import re
            date_pattern = r'^\d{4}-\d{2}-\d{2}$'
            if not re.match(date_pattern, start_date) or not re.match(date_pattern, end_date):
                return jsonify({"error": "Dates must be in YYYY-MM-DD format"}), 400

            # Read the output projects CSV
            projects_file = portfolio_path / "output" / "projects.csv"
            if not projects_file.exists():
                return jsonify({"error": "Output projects.csv not found. Run the model first."}), 404

            import csv
            projects_data = []
            fieldnames = None
            project_found = False

            with open(projects_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames
                for row in reader:
                    if row['id'] == project_id:
                        row['start_date'] = start_date
                        row['end_date'] = end_date
                        project_found = True
                    projects_data.append(row)

            if not project_found:
                return jsonify({"error": f"Project with id '{project_id}' not found"}), 404

            # Write back to CSV
            with open(projects_file, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(projects_data)

            return jsonify({
                "success": True,
                "project_id": project_id,
                "start_date": start_date,
                "end_date": end_date
            })

        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/output/bottleneck/<portfolio_name>")
    def get_bottleneck_analysis(portfolio_name: str):
        """Get bottleneck_analysis.md from output folder"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            bottleneck_file = portfolio_path / "output" / "bottleneck_analysis.md"
            if not bottleneck_file.exists():
                return jsonify({"error": "Bottleneck analysis not found. Run the model first."}), 404

            with open(bottleneck_file, 'r') as f:
                content = f.read()

            return jsonify({"markdown": content})
        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/allocation/<portfolio_name>")
    def save_allocation(portfolio_name: str):
        """Save allocation changes to resource_capacity.csv"""
        try:
            portfolio_path = projects_root / portfolio_name
            portfolio_path = portfolio_path.resolve()
            _validate_within_root(portfolio_path, projects_root)

            changes_data = request.get_json()
            if not isinstance(changes_data, dict) or 'changes' not in changes_data:
                return jsonify({"error": "Invalid request format"}), 400

            changes = changes_data['changes']
            if not isinstance(changes, list):
                return jsonify({"error": "changes must be an array"}), 400

            allocation_file = portfolio_path / "output" / "resource_capacity.csv"
            if not allocation_file.exists():
                return jsonify({"error": "resource_capacity.csv not found"}), 404

            import csv

            # Read existing data
            allocation_data = []
            with open(allocation_file, 'r', newline='') as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames
                for row in reader:
                    allocation_data.append(row)

            # Apply changes
            for change in changes:
                person = change['person']
                project = change['project']
                month = change['month']
                new_value = float(change['newValue'])

                # Find and update the matching row
                for row in allocation_data:
                    if (row['person'] == person and
                        row['project_name'] == project and
                        row['month'] == month):
                        row['project_alloc_pct'] = f"{new_value:.4f}"
                        break

            # Recalculate total_pct for each person/month combination
            person_month_totals = {}
            for row in allocation_data:
                person = row['person']
                month = row['month']
                project_alloc = float(row['project_alloc_pct'])

                key = f"{person}|{month}"
                if key not in person_month_totals:
                    person_month_totals[key] = 0.0
                person_month_totals[key] += project_alloc

            # Update total_pct for all rows
            for row in allocation_data:
                person = row['person']
                month = row['month']
                key = f"{person}|{month}"
                row['total_pct'] = f"{person_month_totals[key]:.4f}"

            # Write back to CSV
            with open(allocation_file, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(allocation_data)

            return jsonify({
                "success": True,
                "changes_applied": len(changes)
            })

        except (ValueError, OSError) as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/portfolio/create")
    def create_portfolio():
        """Create a new portfolio from the portfoliotester template"""
        try:
            data = request.get_json()
            if not data or 'name' not in data:
                return jsonify({"error": "Portfolio name is required"}), 400

            portfolio_name = data['name']

            # Validate portfolio name (lowercase letters, numbers, hyphens only)
            import re
            if not re.match(r'^[a-z0-9-]+$', portfolio_name):
                return jsonify({"error": "Portfolio name must contain only lowercase letters, numbers, and hyphens"}), 400

            # Check if portfolio already exists
            new_portfolio_path = projects_root / portfolio_name
            if new_portfolio_path.exists():
                return jsonify({"error": f"Portfolio '{portfolio_name}' already exists"}), 400

            # Copy portfoliotester as template
            template_path = projects_root / "portfoliotester"
            if not template_path.exists():
                return jsonify({"error": "Template portfolio 'portfoliotester' not found"}), 500

            # Copy the template
            import shutil
            shutil.copytree(template_path, new_portfolio_path)

            # Clear output directory if it exists
            output_dir = new_portfolio_path / "output"
            if output_dir.exists():
                for file in output_dir.iterdir():
                    if file.is_file():
                        file.unlink()

            return jsonify({
                "success": True,
                "portfolio_name": portfolio_name,
                "path": str(new_portfolio_path)
            })

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return app


if __name__ == "__main__":
    create_app().run(debug=True)
