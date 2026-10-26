"""Uploads a self-distillation training JSONL (see
tools/export_finetune_dataset.py) to Azure AI Foundry and launches a
fine-tuning job, using our own live grounding-checked Narrator outputs as
training data.

Base model defaults to gpt-4.1-mini: confirmed fine-tunable in this Foundry
resource (az cognitiveservices account list-models). Our production
Narrator deployment (gpt-5-mini) does NOT support fine-tuning in this
account, which is exactly why this exists as a separate, smaller model
rather than a fine-tune of production itself.

Auth: AAD (DefaultAzureCredential / az login or the Container App's managed
identity), matching the rest of this codebase -- no API key ever handled.

Gotchas discovered the hard way (job submission failed via the classic
`api-version=2024-10-21` REST surface and the newer `/openai/v1/` one with
every documented request shape -- only the Foundry *portal*'s wizard
produced a working request, inspected afterward via GET to find the exact
shape that actually works):
  - Must POST to the newer `/openai/v1/fine_tuning/jobs` path, not the
    classic `api-version=`-querystring one -- gpt-4.1-mini's `fine_tune`
    capability is false for the classic "Standard" training type, only
    `devtier_fine_tune`/`global_fine_tune` are true, and the classic
    surface has no way to request a non-Standard training type.
  - The field is `training_type` (snake_case in the request body this
    account's v1 endpoint actually accepts -- NOT the camelCase
    `trainingType` Microsoft's own docs example shows), value `"developer"`.
  - The hyperparameters' "auto" sentinel is the INTEGER `-1` for
    `batch_size`/`n_epochs` (and `2` for `learning_rate_multiplier`, per
    what the portal itself submitted) -- NOT the string `"auto"` the
    OpenAI SDK and Microsoft's docs both show. Sending the string "auto"
    fails outright ("contains an invalid value"); sending real numeric
    values for all three fields causes training_type to silently be
    ignored and the job to fall back to the unsupported "Standard" type.
    This looks like a genuine bug in this preview endpoint as of
    2026-10-24 -- re-verify if it starts working the documented way.

Usage:
  python -m tools.launch_finetune upload <path.jsonl>
  python -m tools.launch_finetune submit <path.jsonl> [model] [suffix]
  python -m tools.launch_finetune status <job_id>
"""
from __future__ import annotations

import os
import sys
import time

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI, OpenAI

_ACCOUNT = os.environ.get("PITCH_FOUNDRY_ACCOUNT", "pitch-insights-engine-kb")
_ENDPOINT = f"https://{_ACCOUNT}.cognitiveservices.azure.com/"
_API_VERSION = "2024-10-21"
_DEFAULT_BASE_MODEL = "gpt-4.1-mini"
_DEFAULT_SUFFIX = "pitch-narrator"


def _token() -> str:
    return DefaultAzureCredential().get_token("https://cognitiveservices.azure.com/.default").token


def _client() -> AzureOpenAI:
    token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
    return AzureOpenAI(azure_endpoint=_ENDPOINT, azure_ad_token_provider=token_provider, api_version=_API_VERSION)


def _v1_client() -> OpenAI:
    # The classic AzureOpenAI client's api-version=querystring surface
    # doesn't support training_type at all -- see module docstring. Reads
    # (retrieve/list_events) work fine on either surface, only job
    # creation needs this one.
    return OpenAI(base_url=_ENDPOINT.rstrip("/") + "/openai/v1/", api_key=_token())


def upload(path: str) -> str:
    client = _client()
    with open(path, "rb") as f:
        result = client.files.create(file=f, purpose="fine-tune")
    print(f"uploaded {path} -> file_id={result.id} status={result.status}")
    return result.id


def submit(path: str, model: str = _DEFAULT_BASE_MODEL, suffix: str = _DEFAULT_SUFFIX) -> str:
    client = _client()
    file_id = upload(path)
    for _ in range(60):
        f = client.files.retrieve(file_id)
        if f.status == "processed":
            break
        if f.status == "error":
            raise RuntimeError(f"file {file_id} failed to process: {f}")
        time.sleep(5)
    else:
        raise TimeoutError(f"file {file_id} did not finish processing within 5 minutes")

    job = _v1_client().fine_tuning.jobs.create(
        model=model, training_file=file_id, suffix=suffix,
        extra_body={
            "training_type": "developer",
            "method": {
                "type": "supervised",
                "supervised": {
                    "hyperparameters": {"batch_size": -1, "learning_rate_multiplier": 2, "n_epochs": -1},
                },
            },
        },
    )
    print(f"submitted fine-tuning job {job.id} (base model={model}, status={job.status})")
    return job.id


def status(job_id: str) -> None:
    client = _client()
    job = client.fine_tuning.jobs.retrieve(job_id)
    print(f"job {job_id}: status={job.status} model={job.model} fine_tuned_model={job.fine_tuned_model}")
    events = client.fine_tuning.jobs.list_events(fine_tuning_job_id=job_id, limit=10)
    for e in reversed(events.data):
        print(f"  [{e.created_at}] {e.message}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "upload":
        upload(sys.argv[2])
    elif cmd == "submit":
        model = sys.argv[3] if len(sys.argv) > 3 else _DEFAULT_BASE_MODEL
        suffix = sys.argv[4] if len(sys.argv) > 4 else _DEFAULT_SUFFIX
        submit(sys.argv[2], model, suffix)
    elif cmd == "status":
        status(sys.argv[2])
    else:
        raise SystemExit(f"unknown command {cmd!r}")
