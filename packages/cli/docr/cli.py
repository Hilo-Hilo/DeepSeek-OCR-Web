import os
import subprocess
import sys
import time
from typing import Optional

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from .client import DocrClient, pick_markdown_file
from .utils import derive_output_path, ensure_md_extension, safe_filename

console = Console()


def _print_logs(client: DocrClient, task_id: str, duration_s: int = 30) -> None:
    console.print(f"[bold]Logs[/bold] for {task_id} (first {duration_s}s):")
    try:
        for line in client.ws_logs(task_id, duration_s=duration_s):
            console.print(line)
    except Exception as exc:
        console.print(f"[yellow]Log stream error:[/yellow] {exc}")


def _poll_and_download(client: DocrClient, task_id: str, source_path: str, output_path: Optional[str] = None) -> None:
    # Best-effort background polling; daemon thread will stop when process exits.
    while True:
        try:
            prog = client.progress(task_id)
        except Exception:
            time.sleep(5)
            continue
        state = prog.get("state") or prog.get("status")
        if state in {"completed", "succeeded", "success", "done", "finished"}:
            break
        if state in {"failed", "error", "canceled", "cancelled"}:
            return
        time.sleep(5)

    try:
        result = client.result(task_id)
        result_dir = result.get("result_dir")
        files = result.get("files") or []
        md_name = pick_markdown_file(files)
        if not result_dir or not md_name:
            return
        content = client.file_content(f"{result_dir}/{md_name}")
        text = content.get("content", "")
        out_path = derive_output_path(source_path, output_path)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        return


def _start_task(client: DocrClient, source_path: str, prompt: str = "") -> str:
    upload = client.upload(source_path)
    file_path = upload.get("file_path")
    if not file_path:
        raise click.ClickException("Upload failed: missing file_path in response.")
    original_filename = upload.get("original_filename") or safe_filename(source_path)
    start = client.start(file_path=file_path, original_filename=original_filename, prompt=prompt)
    return start.get("task_id")


@click.group(
    context_settings={"help_option_names": ["-h", "--help"]},
)
@click.version_option()
@click.pass_context
def main(ctx: click.Context) -> None:
    """DeepSeek OCR CLI."""
    ctx.obj = {
        "client": DocrClient(),
    }


@main.command(name="convert")
@click.argument("pdf_paths", nargs=-1, type=click.Path(exists=True, dir_okay=False))
@click.option("--prompt", default="", help="Optional OCR prompt.")
@click.pass_context
def convert_cmd(ctx: click.Context, pdf_paths: tuple, prompt: str) -> None:
    """Upload file(s) and start OCR tasks."""
    if not pdf_paths:
        raise click.UsageError("Provide at least one file path.")

    client: DocrClient = ctx.obj["client"]

    with Progress(SpinnerColumn(), TextColumn("{task.description}")) as progress:
        for path in pdf_paths:
            task = progress.add_task(f"Starting {path}", total=None)
            try:
                task_id = _start_task(client, path, prompt=prompt)
            except Exception as exc:
                progress.update(task, description=f"Failed {path}: {exc}")
                continue
            progress.update(task, description=f"Started {path} -> {task_id}")
            progress.remove_task(task)

            # Spawn background process to poll and download when complete
            # This survives the CLI exit (unlike daemon threads)
            output_path = derive_output_path(os.path.abspath(path))
            background_script = os.path.join(os.path.dirname(__file__), "background.py")
            subprocess.Popen(
                [sys.executable, background_script, client.base_url, task_id, output_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,  # Detach from parent
            )

            _print_logs(client, task_id, duration_s=30)
            console.print(f"[green]Task started:[/green] {task_id}")
            console.print(f"Output will be saved to: {output_path}")
            console.print(f"Check status with: docr status {task_id}")


@main.command(name="status")
@click.argument("task_id", required=False)
@click.pass_context
def status_cmd(ctx: click.Context, task_id: Optional[str]) -> None:
    """Show status for a task or list running tasks."""
    client: DocrClient = ctx.obj["client"]

    if task_id:
        prog = client.progress(task_id)
        status = prog.get("state") or prog.get("status")
        progress = prog.get("progress")
        console.print(f"Task {task_id}: {status} ({progress}%)")
        try:
            _print_logs(client, task_id, duration_s=5)
        except Exception:
            pass
        return

    history = client.history()
    jobs = history.get("jobs") or []
    running = [j for j in jobs if (j.get("status") or j.get("state")) == "running"]
    table = Table(title="Running Tasks")
    table.add_column("task_id")
    table.add_column("filename")
    table.add_column("status")
    table.add_column("progress")
    for job in running:
        table.add_row(
            str(job.get("task_id")),
            str(job.get("filename") or job.get("original_filename") or ""),
            str(job.get("status") or job.get("state")),
            str(job.get("progress") or ""),
        )
    console.print(table)


@main.command(name="list")
@click.pass_context
def list_cmd(ctx: click.Context) -> None:
    """List recent jobs."""
    client: DocrClient = ctx.obj["client"]
    history = client.history()
    jobs = history.get("jobs") or []

    table = Table(title="Recent Jobs")
    table.add_column("task_id")
    table.add_column("filename")
    table.add_column("status")
    table.add_column("progress")
    table.add_column("timestamp")

    for job in jobs:
        table.add_row(
            str(job.get("task_id")),
            str(job.get("filename") or job.get("original_filename") or ""),
            str(job.get("status") or job.get("state")),
            str(job.get("progress") or ""),
            str(job.get("timestamp") or job.get("created_at") or ""),
        )

    console.print(table)


@main.command(name="logs")
@click.argument("task_id")
@click.option("--duration", default=30, help="Seconds to stream logs.")
@click.pass_context
def logs_cmd(ctx: click.Context, task_id: str, duration: int) -> None:
    """Stream logs for a task."""
    client: DocrClient = ctx.obj["client"]
    _print_logs(client, task_id, duration_s=duration)


@main.command(name="download")
@click.argument("task_id")
@click.option("--output", type=click.Path(dir_okay=False), default=None)
@click.pass_context
def download_cmd(ctx: click.Context, task_id: str, output: Optional[str]) -> None:
    """Download result markdown for a completed task."""
    client: DocrClient = ctx.obj["client"]
    result = client.result(task_id)
    result_dir = result.get("result_dir")
    files = result.get("files") or []
    md_name = pick_markdown_file(files)
    if not result_dir or not md_name:
        raise click.ClickException("No result file available yet.")

    content = client.file_content(f"{result_dir}/{md_name}")
    text = content.get("content", "")

    if output is None:
        output = ensure_md_extension(md_name)
    out_path = derive_output_path(output, output_path=output)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
    console.print(f"[green]Saved[/green] {out_path}")


@main.command(name="cancel")
@click.argument("task_id")
@click.pass_context
def cancel_cmd(ctx: click.Context, task_id: str) -> None:
    """Cancel a running task."""
    client: DocrClient = ctx.obj["client"]
    resp = client.cancel(task_id)
    console.print(resp)
