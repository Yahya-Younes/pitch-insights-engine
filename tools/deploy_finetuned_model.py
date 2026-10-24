"""Deploys (or deletes) a deployment for a completed fine-tuning job's model,
using the "DeveloperTier" SKU -- confirmed via `az cognitiveservices account
list-models` to be a pure pay-per-token tier for fine-tuned models (no
separate hourly hosting meter, unlike the "Standard" tier's $1.70/hr charge).
Right for testing/demoing a fine-tune without an always-on cost risk; not
meant for high-throughput production traffic, which would use "Standard".

Usage:
  python -m tools.deploy_finetuned_model create <fine_tuned_model_id> [deployment_name]
  python -m tools.deploy_finetuned_model delete <deployment_name>
  python -m tools.deploy_finetuned_model list
"""
from __future__ import annotations

import json
import subprocess
import sys

_ACCOUNT = "pitch-insights-engine"
_RESOURCE_GROUP = "pitch-hackathon-rg"


def _run(args: list[str]) -> dict:
    # shell=True: on Windows, `az` resolves to az.cmd, which CreateProcess
    # can't launch directly without going through a shell.
    result = subprocess.run(["az", *args, "-o", "json"], capture_output=True, text=True, shell=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def create(fine_tuned_model_id: str, deployment_name: str = "pitch-narrator-ft") -> None:
    print(f"creating deployment {deployment_name!r} for model {fine_tuned_model_id!r} on DeveloperTier (no hourly hosting fee)...")
    result = _run([
        "cognitiveservices", "account", "deployment", "create",
        "--name", _ACCOUNT, "--resource-group", _RESOURCE_GROUP,
        "--deployment-name", deployment_name,
        "--model-format", "OpenAI", "--model-name", fine_tuned_model_id, "--model-version", "1",
        "--sku-name", "DeveloperTier", "--sku-capacity", "50",
    ])
    print(json.dumps(result, indent=2)[:1000])
    print(f"\ndeployment {deployment_name!r} created. Remember to delete it when done testing:")
    print(f"  python -m tools.deploy_finetuned_model delete {deployment_name}")


def delete(deployment_name: str) -> None:
    print(f"deleting deployment {deployment_name!r}...")
    _run([
        "cognitiveservices", "account", "deployment", "delete",
        "--name", _ACCOUNT, "--resource-group", _RESOURCE_GROUP, "--deployment-name", deployment_name,
    ])
    print("deleted.")


def list_deployments() -> None:
    result = _run(["cognitiveservices", "account", "deployment", "list", "--name", _ACCOUNT, "--resource-group", _RESOURCE_GROUP])
    for d in result:
        props = d.get("properties", {})
        model = props.get("model", {})
        print(f"{d['name']}: model={model.get('name')} version={model.get('version')} sku={d.get('sku', {}).get('name')} state={props.get('provisioningState')}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "create":
        name = sys.argv[3] if len(sys.argv) > 3 else "pitch-narrator-ft"
        create(sys.argv[2], name)
    elif cmd == "delete":
        delete(sys.argv[2])
    elif cmd == "list":
        list_deployments()
    else:
        raise SystemExit(f"unknown command {cmd!r}")
