#!/usr/bin/env python3
"""Validate ownership, traceability, context coverage, and safe evidence links."""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

NAMESPACES = (
    "BR|PR|NFR|DS|TD|ADR|ARCH|DATA|TEN|IAM|DOM|API|UI|UX|BILL|SEC|PRIV|CTRL|"
    "SLI|SLO|DR|DEL|MIG|OBS|RATE|CTX|OVR|JUR|XFER|LOC|TEST|EVID"
)
ID_RE = re.compile(rf"\b(?:(?:{NAMESPACES})(?:-[A-Z0-9]+)*-\d+|T-?\d+)\b")
DECLARATION_HEADING_RE = re.compile(rf"^\s*#{{2,6}}\s+(?:\[[ xX]\]\s+)?((?:(?:{NAMESPACES})(?:-[A-Z0-9]+)*-\d+|T-?\d+))\b")
TASK_ID_RE = re.compile(r"^T-?(\d+)$")
TASK_HEADING_RE = re.compile(r"^\s*(#{2,6})\s+(?:\[[ xX]\]\s+)?T-?\d+\b")
ANY_HEADING_RE = re.compile(r"^\s*(#{1,6})\s")
PLACEHOLDER_ZERO_RE = re.compile(r"^(?:JUR(?:-[A-Z]+)?|XFER|LOC)-0$")
TBD_RE = re.compile(r"\[TBD[^\]]*\]", re.IGNORECASE)
VALID_TBD_RE = re.compile(r"\[TBD\s+owner=[^;\]]+;\s*due=(?:\d{4}-\d{2}-\d{2}|before [^\]]+)\]", re.IGNORECASE)
SECRET_RE = re.compile(r"(?:api[_-]?key|access[_-]?token|password|private[_-]?key)\s*[:=]\s*[A-Za-z0-9_/+.-]{16,}", re.I)
SOURCE_STATES = {"proposed", "adopted", "enacted", "in-force", "superseded", "unknown"}
CLAIM_STATUSES = {"observed", "decision", "assumption", "proposal", "unknown", "evidence"}
EVIDENCE_KINDS = {
    "direct-observation",
    "external-publication",
    "calculated-result",
    "inference",
    "hypothesis",
    "human-policy",
    "none",
}
STATUS_EVIDENCE_KINDS = {
    "observed": {"direct-observation"},
    "evidence": {"external-publication", "calculated-result"},
    "proposal": {"inference"},
    "assumption": {"hypothesis"},
    "decision": {"human-policy"},
    "unknown": {"none"},
}
STAGES = ("research", "planning", "ready", "verified")
INPUT_ID_RE = re.compile(r"^INPUT-[A-Z0-9]+(?:-[A-Z0-9]+)*$")
NON_RUNTIME_EVIDENCE_RE = re.compile(
    r"(?:^|[/_. -])(?:plan|diagram|example|template|checklist|tasks?|done[- ]when)(?:$|[/_. -])",
    re.IGNORECASE,
)
ARTIFACT_FILENAMES = {
    ("01-BRD.md", "01-BRD.md"), ("02-PRD.md", "02-PRD.md"),
    ("03-TECHNICAL-DESIGN.md", "03-TECHNICAL-DESIGN.md"),
    ("04-SYSTEM-ARCHITECTURE.md", "04-SYSTEM-ARCHITECTURE.md"),
    ("05-DATA-MODEL.md", "05-DATA-MODEL.md"),
    ("06-TENANT-ISOLATION.md", "06-TENANT-ISOLATION.md"),
    ("07-IAM-RBAC-ABAC.md", "07-IAM-RBAC-ABAC.md"),
    ("08-DOMAIN-ROUTING.md", "08-DOMAIN-ROUTING.md"),
    ("09-API-SPECIFICATION.md", "09-API-SPECIFICATION.md"),
    ("10-DESIGN-SYSTEM-WHITELABEL.md", "10-DESIGN-SYSTEM-WHITELABEL.md"),
    ("11-BILLING-PAYMENTS.md", "11-BILLING-PAYMENTS.md"),
    ("12-SECURITY-ARCHITECTURE.md", "12-SECURITY-ARCHITECTURE.md"),
    ("13-COMPLIANCE-PRIVACY.md", "13-COMPLIANCE-PRIVACY.md"),
    ("14-SLA-DRP.md", "14-SLA-DRP.md"),
    ("15-DEVOPS-CICD-MIGRATIONS.md", "15-DEVOPS-CICD-MIGRATIONS.md"),
    ("16-OBSERVABILITY-RATE-LIMITING.md", "16-OBSERVABILITY-RATE-LIMITING.md"),
    ("17-UX-FLOWS-SCREEN-CONTRACTS.md", "17-UX-FLOWS-SCREEN-CONTRACTS.md"),
}
OWNER_NAMESPACES = {"CTX", "OVR", "JUR", "XFER", "LOC", "DS", "PR", "NFR", "TD", "ARCH", "DATA", "TEN", "IAM", "DOM", "API", "UI", "UX", "BILL", "SEC", "PRIV", "CTRL", "SLI", "SLO", "DR", "DEL", "MIG", "OBS", "RATE"}
OVERLAY_COVERAGE: Dict[str, Tuple[Set[str], Set[str]]] = {
    "multi-tenant": ({"TEN"}, {"06-TENANT-ISOLATION.md"}),
    "identity": ({"IAM"}, {"07-IAM-RBAC-ABAC.md"}),
    "public-api": ({"API"}, {"09-API-SPECIFICATION.md"}),
    "custom-domain": ({"DOM"}, {"08-DOMAIN-ROUTING.md"}),
    "localized-ui": ({"LOC", "UI"}, {"10-DESIGN-SYSTEM-WHITELABEL.md"}),
    "commerce": ({"BILL"}, {"11-BILLING-PAYMENTS.md"}),
    "personal-data": ({"PRIV"}, {"13-COMPLIANCE-PRIVACY.md"}),
    "cross-border": ({"XFER", "PRIV"}, {"13-COMPLIANCE-PRIVACY.md"}),
    "regulated-sector": ({"JUR", "PRIV", "SEC"}, {"12-SECURITY-ARCHITECTURE.md", "13-COMPLIANCE-PRIVACY.md"}),
    "ai-system": ({"SEC", "PRIV"}, {"12-SECURITY-ARCHITECTURE.md", "13-COMPLIANCE-PRIVACY.md"}),
    "high-availability": ({"SLO", "DR"}, {"14-SLA-DRP.md"}),
    "mobile-desktop": ({"TD", "UX"}, {"03-TECHNICAL-DESIGN.md", "17-UX-FLOWS-SCREEN-CONTRACTS.md"}),
    "product-ui": ({"UI", "UX"}, {"10-DESIGN-SYSTEM-WHITELABEL.md", "17-UX-FLOWS-SCREEN-CONTRACTS.md"}),
    "extension-plugin": ({"TD", "SEC"}, {"03-TECHNICAL-DESIGN.md", "12-SECURITY-ARCHITECTURE.md"}),
    "data-analytics": ({"DATA", "OBS"}, {"05-DATA-MODEL.md", "16-OBSERVABILITY-RATE-LIMITING.md"}),
    "persistence": ({"DATA"}, {"05-DATA-MODEL.md"}),
    "production-service": ({"OBS"}, {"16-OBSERVABILITY-RATE-LIMITING.md"}),
    "maintained-deployment": ({"DEL"}, {"15-DEVOPS-CICD-MIGRATIONS.md"}),
}


def canonical_id(identifier: str) -> str:
    match = TASK_ID_RE.fullmatch(identifier.upper())
    return f"T-{match.group(1)}" if match else identifier.upper()


def namespace(identifier: str) -> str:
    return "T" if identifier.startswith("T-") else identifier.split("-", 1)[0]


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def is_separator_row(cells: Sequence[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def split_table_row(line: str) -> List[str]:
    value = line.strip()
    if value.startswith("|"):
        value = value[1:]
    if value.endswith("|"):
        value = value[:-1]
    # Escaped pipes are restored after a sentinel split; Markdown code spans with
    # pipes remain a documented limitation rather than a dependency-worthy parser.
    sentinel = "\u0000"
    value = value.replace("\\|", sentinel)
    return [cell.strip().replace(sentinel, "|") for cell in value.split("|")]


def suite_task_blocks(lines: Sequence[str]) -> List[str]:
    """Blank everything outside `T-*` heading blocks; a same-or-higher heading ends a block."""
    result: List[str] = []
    level = 0
    for line in lines:
        task = TASK_HEADING_RE.match(line)
        heading = ANY_HEADING_RE.match(line)
        if task:
            level = len(task.group(1))
        elif heading and len(heading.group(1)) <= level:
            level = 0
        result.append(line if level else "")
    return result


def strip_code_fences(lines: Sequence[str]) -> List[str]:
    result: List[str] = []
    in_fence = False
    fence = ""
    for line in lines:
        marker = re.match(r"^\s*(```+|~~~+)", line)
        if marker:
            token = marker.group(1)
            if not in_fence:
                in_fence = True
                fence = token[:3]
            elif token.startswith(fence):
                in_fence = False
            result.append("")
        else:
            result.append("" if in_fence else line)
    return result


@dataclass(order=True)
class Finding:
    code: str
    path: str
    line: int
    message: str
    identifier: str = ""

    def as_dict(self) -> Dict[str, object]:
        value: Dict[str, object] = {"code": self.code, "path": self.path, "line": self.line, "message": self.message}
        if self.identifier:
            value["identifier"] = self.identifier
        return value


@dataclass
class Declaration:
    identifier: str
    path: Path
    line: int
    metadata: Dict[str, str] = field(default_factory=dict)
    text: str = ""
    metadata_occurrences: Dict[str, List[str]] = field(default_factory=dict)


@dataclass
class MarketInput:
    identifier: str
    path: Path
    line: int
    metadata: Dict[str, object]


@dataclass
class Reference:
    identifier: str
    path: Path
    line: int
    context: str


class Validator:
    def __init__(self, root: Path, stage: Optional[str] = None, task_files: Sequence[Path] = ()) -> None:
        self.root = root
        self.stage = stage
        self.findings: List[Finding] = []
        self.declarations: Dict[str, List[Declaration]] = {}
        self.references: List[Reference] = []
        self.placeholder_ids: Set[str] = set()
        self.market_inputs: List[MarketInput] = []
        self.source_ids: Set[str] = set()
        ignored_dirs = {".spec-update", ".spec-backups"}
        self.files: List[Path] = sorted(path for path in root.rglob("*.md") if not ignored_dirs.intersection(path.relative_to(root).parts))
        self.json_files: List[Path] = sorted(path for path in root.rglob("*.json") if not ignored_dirs.intersection(path.relative_to(root).parts))
        self.file_names = {path.name for path in self.files}
        # Extra execution queues (root TASKS.md) contribute only their `T-*` suite task blocks.
        self.task_files: Set[Path] = {path for path in task_files if path not in self.files}
        self.files.extend(sorted(self.task_files))

    def relative(self, path: Path) -> str:
        if path in self.task_files:
            return Path(os.path.relpath(path, self.root)).as_posix()
        return path.relative_to(self.root).as_posix()

    def add(self, code: str, path: Path, line: int, message: str, identifier: str = "") -> None:
        self.findings.append(Finding(code, self.relative(path), line, message, identifier))

    def declare(self, declaration: Declaration) -> None:
        declaration.identifier = canonical_id(declaration.identifier)
        if PLACEHOLDER_ZERO_RE.match(declaration.identifier):
            return
        if declaration.path in self.task_files and not declaration.identifier.startswith("T-"):
            return
        self.declarations.setdefault(declaration.identifier, []).append(declaration)

    def scan_file(self, path: Path) -> None:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            self.add("MD005", path, 1, f"file is not valid UTF-8: {exc}")
            return
        lines = text.splitlines()
        visible = strip_code_fences(lines)
        if path in self.task_files:
            visible = suite_task_blocks(visible)
        fence_count = sum(1 for line in lines if re.match(r"^\s*(```+|~~~+)", line))
        if fence_count % 2:
            self.add("MD001", path, len(lines), "unbalanced fenced code block")

        for line_number, line in enumerate(visible, 1):
            for match in TBD_RE.finditer(line):
                value = match.group(0)
                template_instruction = re.search(r"\[[A-Za-z][^\]]*\]", line[: match.start()] + line[match.end() :])
                if not VALID_TBD_RE.fullmatch(value) and not template_instruction:
                    self.add("OWN003", path, line_number, "TBD must use '[TBD owner=<role>; due=<YYYY-MM-DD|before gate>]' format")
            if SECRET_RE.search(line):
                self.add("SEC001", path, line_number, "credential-like assignment must not be stored in a specification")
            for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", line):
                destination = link.strip().split("#", 1)[0]
                if not destination or destination.startswith(("http://", "https://", "mailto:")):
                    continue
                resolved = path.parent / destination
                if not resolved.exists():
                    # A flat suite intentionally omits untriggered canonical artifacts.
                    if destination in {target for _source, target in ARTIFACT_FILENAMES}:
                        continue
                    self.add("LINK001", path, line_number, f"broken local link: {destination}")

        self.scan_tables(path, visible)
        self.scan_headings(path, visible)
        for line_number, line in enumerate(visible, 1):
            if re.search(r"<[^>]+>|\[[A-Z][A-Z0-9 *-]*\]", line):
                continue
            for match in ID_RE.finditer(line):
                identifier = canonical_id(match.group(0))
                if PLACEHOLDER_ZERO_RE.match(identifier):
                    continue
                self.references.append(Reference(identifier, path, line_number, line.strip()))

    def scan_tables(self, path: Path, lines: Sequence[str]) -> None:
        index = 0
        while index + 1 < len(lines):
            if "|" not in lines[index] or "|" not in lines[index + 1]:
                index += 1
                continue
            headers = split_table_row(lines[index])
            separator = split_table_row(lines[index + 1])
            if len(headers) < 2 or len(separator) != len(headers) or not is_separator_row(separator):
                index += 1
                continue
            normalized = [normalize_header(header) for header in headers]
            row_index = index + 2
            while row_index < len(lines) and "|" in lines[row_index] and lines[row_index].strip():
                cells = split_table_row(lines[row_index])
                if len(cells) != len(headers):
                    self.add("MD004", path, row_index + 1, f"table row has {len(cells)} cells; expected {len(headers)}")
                    row_index += 1
                    continue
                occurrences: Dict[str, List[str]] = {}
                for position, cell in enumerate(cells):
                    occurrences.setdefault(normalized[position], []).append(cell.strip("` "))
                metadata = {key: values[0] for key, values in occurrences.items()}
                first = cells[0].strip("` ")
                if ID_RE.fullmatch(first):
                    identifier = canonical_id(first)
                    placeholder = re.search(r"<[^>]+>|\[[A-Z][A-Z0-9 *-]*\]", lines[row_index])
                    if placeholder:
                        self.placeholder_ids.add(identifier)
                    self.declare(Declaration(identifier, path, row_index + 1, metadata, lines[row_index], occurrences))
                elif self.stage and INPUT_ID_RE.fullmatch(first.upper()):
                    self.market_inputs.append(MarketInput(first.upper(), path, row_index + 1, metadata))
                row_index += 1
            index = row_index

    def scan_headings(self, path: Path, lines: Sequence[str]) -> None:
        headings: List[Tuple[int, str]] = []
        for index, line in enumerate(lines):
            match = DECLARATION_HEADING_RE.match(line)
            if match:
                headings.append((index, match.group(1)))
        for position, (start, identifier) in enumerate(headings):
            end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
            block = lines[start + 1 : end]
            metadata: Dict[str, str] = {}
            occurrences: Dict[str, List[str]] = {}
            for line in block:
                match = re.match(r"^\s*-\s*([^:]+):\s*(.+?)\s*$", line)
                if match:
                    key = normalize_header(match.group(1))
                    value = match.group(2).strip()
                    metadata.setdefault(key, value)
                    occurrences.setdefault(key, []).append(value)
            self.declare(Declaration(identifier, path, start + 1, metadata, "\n".join(block), occurrences))

    @staticmethod
    def metadata_value(declaration: Declaration, names: Iterable[str]) -> str:
        normalized_names = {normalize_header(name) for name in names}
        for key, value in declaration.metadata.items():
            if key in normalized_names or any(name in key for name in normalized_names):
                return value.strip()
        return ""

    @staticmethod
    def exact_metadata_value(declaration: Declaration, names: Iterable[str]) -> str:
        for name in names:
            value = declaration.metadata.get(normalize_header(name))
            if value is not None:
                return value.strip()
        return ""

    @staticmethod
    def metadata_values(declaration: Declaration, names: Iterable[str]) -> List[str]:
        normalized_names = {normalize_header(name) for name in names}
        values: List[str] = []
        for key, occurrences in declaration.metadata_occurrences.items():
            if key in normalized_names:
                values.extend(value.strip() for value in occurrences)
        return values

    def scan_stage_json(self) -> None:
        for path in self.json_files:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                self.add("JSON001", path, 1, f"invalid UTF-8 JSON metadata: {exc}")
                continue

            if isinstance(payload, dict):
                records = payload.get("records")
                if isinstance(records, list):
                    for record in records:
                        if isinstance(record, dict) and str(record.get("id", "")).upper().startswith("SRC-"):
                            self.source_ids.add(str(record["id"]).upper())
                raw_inputs = payload.get("market_inputs", payload.get("market-inputs"))
                if raw_inputs is None and INPUT_ID_RE.fullmatch(str(payload.get("id", "")).upper()):
                    raw_inputs = [payload]
            else:
                raw_inputs = None

            if not isinstance(raw_inputs, list):
                continue
            for record in raw_inputs:
                if not isinstance(record, dict):
                    self.add("MKT001", path, 1, "market_inputs entries must be JSON objects")
                    continue
                identifier = str(record.get("id", "")).upper()
                if not INPUT_ID_RE.fullmatch(identifier):
                    self.add("MKT001", path, 1, f"invalid market input id '{identifier or '<missing>'}'", identifier)
                    continue
                metadata = {normalize_header(str(key)): value for key, value in record.items()}
                self.market_inputs.append(MarketInput(identifier, path, 1, metadata))

    @staticmethod
    def record_value(record: MarketInput, *names: str) -> object:
        for name in names:
            key = normalize_header(name)
            if key in record.metadata:
                return record.metadata[key]
        return ""

    @staticmethod
    def record_present(record: MarketInput, *names: str) -> bool:
        value = Validator.record_value(record, *names)
        return value is not None and value != "" and value != []

    @staticmethod
    def truthy(value: object) -> bool:
        return value is True or (isinstance(value, str) and value.strip().lower() in {"1", "true", "yes"})

    @staticmethod
    def referenced_ids(value: str, prefixes: Set[str]) -> List[str]:
        return [
            canonical_id(match.group(0))
            for match in ID_RE.finditer(value)
            if namespace(canonical_id(match.group(0))) in prefixes
        ]

    @staticmethod
    def iso_date(value: str) -> Optional[str]:
        match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", value)
        return match.group(0) if match else None

    def validate_declarations(self) -> None:
        for identifier, declarations in sorted(self.declarations.items()):
            substantive = [item for item in declarations if not re.search(r"<[^>]+>|\[[A-Za-z][^\]]*\]", item.text)]
            if len(substantive) > 1:
                locations = ", ".join(f"{self.relative(item.path)}:{item.line}" for item in substantive)
                for item in substantive:
                    self.add("ID001", item.path, item.line, f"duplicate declaration for {identifier}; declarations: {locations}", identifier)
            declaration = substantive[0] if substantive else declarations[0]
            prefix = namespace(identifier)
            placeholder_declaration = identifier in self.placeholder_ids or bool(re.search(r"\[[A-Za-z][^\]]*\]", declaration.text))
            if prefix in OWNER_NAMESPACES and not placeholder_declaration:
                owner = self.metadata_value(declaration, ("owner", "accountable owner", "system owner", "qualified owner", "engineering owner", "implementation owner", "component owner"))
                if not owner or owner.lower() in {"unknown", "none", "not recorded", "[role]", "<role>"}:
                    self.add("OWN001", declaration.path, declaration.line, f"{identifier} has no accountable owner", identifier)
            if self.stage and not placeholder_declaration:
                owner_values = self.metadata_values(
                    declaration,
                    ("owner", "accountable owner", "system owner", "qualified owner", "engineering owner", "implementation owner", "component owner"),
                )
                if len(owner_values) > 1:
                    self.add("OWN004", declaration.path, declaration.line, f"{identifier} declares multiple canonical owners", identifier)
                if prefix == "ADR" and not owner_values:
                    self.add("OWN001", declaration.path, declaration.line, f"{identifier} has no accountable owner", identifier)

    def validate_references(self) -> None:
        declared = set(self.declarations)
        for reference in self.references:
            if reference.identifier in self.placeholder_ids:
                continue
            if namespace(reference.identifier) in {"TEST", "EVID"}:
                continue
            if reference.identifier not in declared:
                self.add("REF001", reference.path, reference.line, f"unresolved numeric reference {reference.identifier}", reference.identifier)

    def validate_tasks(self) -> None:
        task_declarations = [items[0] for identifier, items in self.declarations.items() if identifier.startswith("T-") and items]
        primary_to_tasks: Dict[str, List[str]] = {}
        for task in task_declarations:
            primary_values = [
                value
                for key, value in task.metadata.items()
                if key in {"primary requirement", "primary req", "req"}
            ]
            identifiers: List[str] = []
            for value in primary_values:
                identifiers.extend(canonical_id(match.group(0)) for match in ID_RE.finditer(value) if not canonical_id(match.group(0)).startswith("T-"))
            if len(identifiers) != 1:
                self.add("TASK001", task.path, task.line, f"{task.identifier} must have exactly one primary requirement; found {len(identifiers)}", task.identifier)
                continue
            # A primary requirement must ANCHOR — either to the canonical namespaces or to a
            # requirement actually DECLARED in the corpus. The first hardening hard-coded
            # {DS, PR, TD} and retroactively flagged ten legitimate tasks in tokophi whose
            # requirements are declared as SEC-*/DOM-*/DR-*/UX-* sections with full
            # Status/Owner/Statement/Done-when metadata. Anchoring to a declared requirement IS the
            # traceability property; the namespace was a proxy for it. Undeclared ids still fail.
            if namespace(identifiers[0]) not in {"DS", "PR", "TD"} and identifiers[0] not in self.declarations:
                self.add("TASK003", task.path, task.line, f"{task.identifier} primary requirement must be DS-*/PR-*/TD-* or a declared requirement; found {identifiers[0]}", task.identifier)
                continue
            primary = identifiers[0]
            primary_to_tasks.setdefault(primary, []).append(task.identifier)
            done_when = self.metadata_value(task, ("done when", "acceptance"))
            if not done_when:
                self.add("TASK002", task.path, task.line, f"{task.identifier} has no runnable Done when check", task.identifier)

        if task_declarations:
            for identifier, declarations in self.declarations.items():
                if namespace(identifier) not in {"DS", "PR", "TD"}:
                    continue
                status = self.metadata_value(declarations[0], ("status",)).lower()
                if status in {"accepted", "implemented", "verified"} and identifier not in primary_to_tasks:
                    self.add("TRACE001", declarations[0].path, declarations[0].line, f"accepted requirement {identifier} has no primary implementation task", identifier)

    def validate_status_and_evidence(self) -> None:
        reference_contexts: Dict[str, List[Reference]] = {}
        for reference in self.references:
            reference_contexts.setdefault(reference.identifier, []).append(reference)
        for identifier, declarations in self.declarations.items():
            declaration = declarations[0]
            status = self.metadata_value(declaration, ("status",)).lower()
            if status == "verified":
                evidence = self.metadata_value(declaration, ("evidence", "acceptance evidence", "verification evidence"))
                if not re.search(r"\b(?:TEST|EVID)-[A-Z0-9-]+\b", evidence):
                    self.add("EVID001", declaration.path, declaration.line, f"verified requirement {identifier} has no TEST-* or EVID-* reference", identifier)
            if status == "superseded":
                replacement = self.metadata_value(declaration, ("superseded by", "replacement"))
                replacement_ids = [canonical_id(match.group(0)) for match in ID_RE.finditer(replacement)]
                if len(replacement_ids) != 1:
                    self.add("SUP001", declaration.path, declaration.line, f"superseded declaration {identifier} must name exactly one replacement", identifier)
                elif replacement_ids[0] not in self.declarations:
                    self.add("SUP002", declaration.path, declaration.line, f"replacement {replacement_ids[0]} is not declared", identifier)
                for reference in reference_contexts.get(identifier, []):
                    context_lower = reference.context.lower()
                    if reference.path == declaration.path and reference.line == declaration.line:
                        continue
                    if "change history" in context_lower or "superseded" in context_lower:
                        continue
                    self.add("SUP003", reference.path, reference.line, f"active reference points to superseded {identifier}", identifier)

    def validate_claims(self) -> None:
        for identifier, declarations in sorted(self.declarations.items()):
            declaration = declarations[0]
            if namespace(identifier) != "CTX":
                continue
            kind = self.exact_metadata_value(declaration, ("evidence kind",)).lower().replace("_", "-")
            status = self.exact_metadata_value(declaration, ("status",)).lower()
            if status not in CLAIM_STATUSES:
                self.add("CLAIM001", declaration.path, declaration.line, f"{identifier} has invalid canonical claim status '{status or '<missing>'}'", identifier)
                continue
            if kind and kind not in EVIDENCE_KINDS:
                self.add("CLAIM002", declaration.path, declaration.line, f"{identifier} has invalid evidence kind '{kind}'", identifier)
                continue
            allowed_kinds = STATUS_EVIDENCE_KINDS[status]
            if allowed_kinds and not kind:
                self.add("CLAIM002", declaration.path, declaration.line, f"{identifier} status '{status}' requires evidence kind {', '.join(sorted(allowed_kinds))}", identifier)
            elif kind not in allowed_kinds:
                self.add("CLAIM003", declaration.path, declaration.line, f"{identifier} status '{status}' is incompatible with evidence kind '{kind}'", identifier)

            source = self.exact_metadata_value(declaration, ("source",))
            derived = self.exact_metadata_value(declaration, ("derived from", "formula lineage"))
            if status in {"observed", "evidence"} and not source and not (status == "evidence" and kind == "calculated-result" and derived):
                self.add("CLAIM004", declaration.path, declaration.line, f"{identifier} fact-status claim has no Source or formula lineage", identifier)
            elif status in {"proposal", "assumption"} and not source and not derived:
                self.add("CLAIM004", declaration.path, declaration.line, f"{identifier} has no Source or Derived from provenance", identifier)

            if kind in {"direct-observation", "external-publication"} and source:
                locator = self.exact_metadata_value(declaration, ("source locator", "locator", "exact path"))
                excerpt = self.exact_metadata_value(declaration, ("source excerpt", "excerpt"))
                if not locator:
                    self.add("CLAIM005", declaration.path, declaration.line, f"{identifier} source has no precise locator", identifier)
                if not excerpt:
                    self.add("CLAIM006", declaration.path, declaration.line, f"{identifier} source has no safe excerpt", identifier)
                source_references = set(re.findall(r"\bSRC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b", source.upper()))
                if self.source_ids:
                    for source_id in sorted(source_references - self.source_ids):
                        self.add("CLAIM007", declaration.path, declaration.line, f"{identifier} references undeclared source ledger record {source_id}", identifier)

    def validate_market_inputs(self) -> None:
        by_identifier: Dict[str, List[MarketInput]] = {}
        for record in self.market_inputs:
            by_identifier.setdefault(record.identifier, []).append(record)
        for identifier, records in sorted(by_identifier.items()):
            if len(records) > 1:
                locations = ", ".join(f"{self.relative(item.path)}:{item.line}" for item in records)
                for record in records:
                    self.add("MKT001", record.path, record.line, f"duplicate market input {identifier}; declarations: {locations}", identifier)
            record = records[0]
            if self.truthy(self.record_value(record, "example only")):
                continue
            for field_name in ("layer", "factor", "boundary", "unit", "period", "geography", "overlap rule"):
                if not self.record_present(record, field_name):
                    self.add("MKT002", record.path, record.line, f"{identifier} is missing required market field '{field_name}'", identifier)
            layer = str(self.record_value(record, "layer")).upper()
            if layer and layer not in {"TAM", "SAM", "SOM"}:
                self.add("MKT002", record.path, record.line, f"{identifier} has invalid market layer '{layer}'", identifier)
            status = str(self.record_value(record, "status")).lower()
            if status not in CLAIM_STATUSES:
                self.add("MKT002", record.path, record.line, f"{identifier} has invalid canonical status '{status or '<missing>'}'", identifier)
            kind = str(self.record_value(record, "evidence kind")).lower().replace("_", "-")
            if kind and kind not in EVIDENCE_KINDS:
                self.add("MKT002", record.path, record.line, f"{identifier} has invalid evidence kind '{kind}'", identifier)
            if status in CLAIM_STATUSES:
                allowed_kinds = STATUS_EVIDENCE_KINDS[status]
                if kind not in allowed_kinds:
                    expected = ", ".join(sorted(allowed_kinds))
                    self.add("MKT002", record.path, record.line, f"{identifier} status '{status}' requires evidence kind {expected}", identifier)
            source = self.record_present(record, "source")
            formula = self.record_present(record, "formula", "formula lineage")
            if not source and not formula:
                self.add("MKT003", record.path, record.line, f"{identifier} has no source or formula lineage", identifier)

            conversion = self.record_value(record, "conversion", "currency conversion")
            if self.truthy(conversion):
                for field_name in ("currency", "conversion date", "conversion method"):
                    if not self.record_present(record, field_name):
                        self.add("MKT004", record.path, record.line, f"{identifier} conversion is missing '{field_name}'", identifier)

            material_forecast = self.record_value(record, "material forecast", "uncertain forecast")
            if self.truthy(material_forecast):
                interval = self.record_present(record, "range low") and self.record_present(record, "range high")
                scenario = self.record_present(record, "scenario", "named scenario")
                deterministic = self.record_present(record, "deterministic assumption")
                if not (interval or scenario or deterministic):
                    self.add("MKT004", record.path, record.line, f"{identifier} material forecast needs an interval, named scenario, or deterministic assumption", identifier)

            formula_text = str(self.record_value(record, "formula", "formula lineage"))
            bare_som_percentage = self.record_present(record, "tam percentage") or bool(
                re.search(r"(?:%|percent).*tam|tam.*(?:%|percent)", formula_text, re.IGNORECASE)
            )
            if layer == "SOM" and bare_som_percentage and not self.record_present(record, "operational drivers", "named scenario", "scenario"):
                self.add("MKT005", record.path, record.line, f"{identifier} encodes SOM as an unsupported bare TAM percentage", identifier)

    def validate_activated_ownership(self) -> None:
        activations: Dict[str, Declaration] = {}
        for declarations in self.declarations.values():
            declaration = declarations[0]
            selected = self.exact_metadata_value(declaration, ("activated artifacts", "selected artifacts", "artifact activation")).lower()
            if re.search(r"\b(?:diagram|architecture|erd|data[- ]flow|sequence)\b", selected):
                activations.setdefault("diagram", declaration)
            if re.search(r"\b(?:openapi|public[- ]api|api[- ]specification|api contract)\b", selected):
                activations.setdefault("openapi", declaration)
            if re.search(r"\b(?:security|threat|control)\b", selected):
                activations.setdefault("security", declaration)
        declared_by_namespace: Dict[str, List[Declaration]] = {}
        for identifier, declarations in self.declarations.items():
            declared_by_namespace.setdefault(namespace(identifier), []).append(declarations[0])

        if "diagram" in activations:
            diagrams = declared_by_namespace.get("ARCH", []) + declared_by_namespace.get("ADR", [])
            if not diagrams:
                item = activations["diagram"]
                self.add("ACT001", item.path, item.line, "activated diagram has no ARCH-* or ADR-* canonical owner", item.identifier)
            elif not any(self.exact_metadata_value(item, ("review", "review owner", "reviewed by")) for item in diagrams):
                item = diagrams[0]
                self.add("ACT004", item.path, item.line, f"{item.identifier} activated diagram has no review metadata", item.identifier)
        if "openapi" in activations:
            api_contracts = declared_by_namespace.get("API", [])
            if not api_contracts:
                item = activations["openapi"]
                self.add("ACT002", item.path, item.line, "activated OpenAPI contract has no API-* canonical owner", item.identifier)
            elif not any(self.exact_metadata_value(item, ("contract", "openapi", "ref")) for item in api_contracts):
                item = api_contracts[0]
                self.add("ACT005", item.path, item.line, f"{item.identifier} activated OpenAPI contract has no preserved contract ref", item.identifier)
        if "security" in activations and not (declared_by_namespace.get("SEC") or declared_by_namespace.get("CTRL")):
            item = activations["security"]
            self.add("ACT003", item.path, item.line, "activated security scope has no SEC-* or CTRL-* canonical owner", item.identifier)

    def validate_runtime_evidence(self) -> None:
        for identifier, declarations in sorted(self.declarations.items()):
            if namespace(identifier) != "EVID":
                continue
            declaration = declarations[0]
            ref = self.exact_metadata_value(declaration, ("ref", "evidence ref", "report"))
            kind = self.exact_metadata_value(declaration, ("evidence kind",)).lower()
            if (kind and kind != "runtime") or (ref and NON_RUNTIME_EVIDENCE_RE.search(ref)):
                self.add("EVID002", declaration.path, declaration.line, f"{identifier} presents a planning/non-runtime artifact as EVID", identifier)
        if self.stage != "verified":
            return

        for identifier, declarations in sorted(self.declarations.items()):
            target = declarations[0]
            if namespace(identifier) in {"TEST", "EVID"}:
                continue
            if self.exact_metadata_value(target, ("status",)).lower() != "verified":
                continue
            evidence = self.exact_metadata_value(target, ("evidence", "acceptance evidence", "verification evidence"))
            test_ids = self.referenced_ids(evidence, {"TEST"})
            evidence_ids = self.referenced_ids(evidence, {"EVID"})
            if len(test_ids) != 1 or len(evidence_ids) != 1:
                self.add("STAGE001", target.path, target.line, f"{identifier} verified claim must link exactly one TEST-* and one EVID-*; found {len(test_ids)} TEST and {len(evidence_ids)} EVID", identifier)
                continue
            test_id, evidence_id = test_ids[0], evidence_ids[0]
            if len(self.declarations.get(test_id, [])) != 1 or len(self.declarations.get(evidence_id, [])) != 1:
                self.add("STAGE002", target.path, target.line, f"{identifier} verified links must resolve to unique {test_id} and {evidence_id} declarations", identifier)
                continue

            test = self.declarations[test_id][0]
            observed = self.declarations[evidence_id][0]
            test_targets = self.referenced_ids(self.exact_metadata_value(test, ("target",)), {"BR", "PR", "NFR", "DS", "TD", "CTX"})
            evidence_targets = self.referenced_ids(self.exact_metadata_value(observed, ("target",)), {"BR", "PR", "NFR", "DS", "TD", "CTX"})
            evidence_tests = self.referenced_ids(self.exact_metadata_value(observed, ("test",)), {"TEST"})
            if test_targets != [identifier] or evidence_targets != [identifier] or evidence_tests != [test_id]:
                self.add("STAGE003", observed.path, observed.line, f"{evidence_id} target/test linkage does not match {identifier} via {test_id}", evidence_id)
            test_ref = self.exact_metadata_value(test, ("ref", "test ref", "command"))
            evidence_ref = self.exact_metadata_value(observed, ("ref", "evidence ref", "report"))
            if not test_ref or not evidence_ref:
                self.add("STAGE004", observed.path, observed.line, f"{identifier} TEST/EVID linkage is missing a reproducible ref", evidence_id)
            outcome = self.exact_metadata_value(observed, ("outcome", "result")).lower()
            if outcome not in {"pass", "passed", "success", "successful"}:
                self.add("STAGE005", observed.path, observed.line, f"{evidence_id} has no structurally passing outcome", evidence_id)
            observed_date = self.iso_date(self.exact_metadata_value(observed, ("observed at", "recorded at", "evidence date", "date")))
            changed_date = self.iso_date(self.exact_metadata_value(target, ("changed at", "last changed", "change date", "updated at")))
            if not observed_date or (changed_date and observed_date < changed_date):
                self.add("STAGE006", observed.path, observed.line, f"{evidence_id} is not structurally fresh for {identifier}", evidence_id)
            target_ref = self.exact_metadata_value(target, ("target ref", "change ref", "revision"))
            observed_target_ref = self.exact_metadata_value(observed, ("target ref",))
            if target_ref and observed_target_ref != target_ref:
                self.add("STAGE007", observed.path, observed.line, f"{evidence_id} target ref does not match {identifier}", evidence_id)

    def validate_context(self) -> None:
        fact_status: Dict[str, str] = {}
        active_overlays: List[Declaration] = []
        for identifier, declarations in self.declarations.items():
            declaration = declarations[0]
            if namespace(identifier) == "CTX":
                fact_status[identifier] = self.metadata_value(declaration, ("status",))
            elif namespace(identifier) == "OVR":
                status = self.metadata_value(declaration, ("status",)).lower()
                if status == "active":
                    active_overlays.append(declaration)

        for overlay in active_overlays:
            trigger_value = self.metadata_value(overlay, ("trigger facts", "triggering facts"))
            triggers = [canonical_id(match.group(0)) for match in ID_RE.finditer(trigger_value) if canonical_id(match.group(0)).startswith("CTX-")]
            if not triggers:
                self.add("OVR001", overlay.path, overlay.line, f"active {overlay.identifier} has no triggering CTX-* fact", overlay.identifier)
            for trigger in triggers:
                if trigger not in self.declarations:
                    continue
                if fact_status.get(trigger, "").lower() == "unknown":
                    self.add("OVR002", overlay.path, overlay.line, f"active {overlay.identifier} is triggered only by unknown fact {trigger}", overlay.identifier)

            overlay_name = self.metadata_value(overlay, ("capability overlay", "overlay", "capability")).lower().strip("` ")
            coverage = OVERLAY_COVERAGE.get(overlay_name)
            if not coverage:
                continue
            prefixes, expected_files = coverage
            actual_prefixes = {namespace(identifier) for identifier in self.declarations}
            if not (prefixes & actual_prefixes):
                self.add("OVR003", overlay.path, overlay.line, f"active overlay '{overlay_name}' has no downstream declaration in {', '.join(sorted(prefixes))}", overlay.identifier)
            if expected_files and not (expected_files & self.file_names):
                self.add("OVR004", overlay.path, overlay.line, f"active overlay '{overlay_name}' is missing selected artifact: one of {', '.join(sorted(expected_files))}", overlay.identifier)

    def validate_jurisdiction_transfer_locale(self) -> None:
        for identifier, declarations in self.declarations.items():
            declaration = declarations[0]
            prefix = namespace(identifier)
            if prefix == "JUR":
                if identifier.startswith("JUR-SECTOR-"):
                    continue
                required_groups = {
                    "trigger facts": ("trigger facts", "triggering facts"),
                    "authority/source": ("authority source", "official source", "source"),
                    "source status": ("source status", "official source status"),
                    "retrieved date": ("retrieved date", "retrieval date"),
                    "decision": ("decision",),
                    "qualified owner": ("qualified owner", "owner"),
                    "next review": ("next review", "recheck trigger"),
                }
                for label, names in required_groups.items():
                    if not self.metadata_value(declaration, names):
                        self.add("JUR001", declaration.path, declaration.line, f"{identifier} is missing required field '{label}'", identifier)
                source_status = self.metadata_value(declaration, ("source status", "official source status")).lower().replace(" ", "-")
                if source_status and source_status not in SOURCE_STATES:
                    self.add("JUR002", declaration.path, declaration.line, f"{identifier} has invalid source status '{source_status}'", identifier)
            elif prefix == "XFER":
                required_groups = {
                    "trigger facts": ("trigger facts",),
                    "exporter role/location": ("exporter role location", "exporter"),
                    "importer role/location": ("importer role location", "importer"),
                    "data subjects/categories": ("data subjects categories", "data subjects"),
                    "purpose": ("purpose",),
                    "storage/remote access": ("storage remote access",),
                    "mechanism review": ("mechanism review", "mechanism status"),
                    "safeguards": ("safeguards",),
                    "onward transfers": ("onward transfers",),
                    "retention/deletion": ("retention deletion",),
                    "evidence": ("evidence",),
                    "owner": ("owner",),
                    "status": ("status",),
                }
                for label, names in required_groups.items():
                    if not self.metadata_value(declaration, names):
                        self.add("XFER001", declaration.path, declaration.line, f"{identifier} is missing required field '{label}'", identifier)
            elif prefix == "LOC":
                test_evidence = self.metadata_value(declaration, ("test evidence", "regional test coverage", "evidence"))
                if not re.search(r"\b(?:TEST|EVID)-[A-Z0-9-]+\b", test_evidence):
                    self.add("LOC001", declaration.path, declaration.line, f"{identifier} has no TEST-* or EVID-* regional test coverage", identifier)

    def run(self) -> List[Finding]:
        if self.stage:
            self.scan_stage_json()
        for path in self.files:
            self.scan_file(path)
        self.validate_declarations()
        self.validate_references()
        self.validate_tasks()
        self.validate_status_and_evidence()
        self.validate_context()
        self.validate_jurisdiction_transfer_locale()
        if self.stage:
            self.validate_claims()
            self.validate_market_inputs()
            if self.stage in {"planning", "ready", "verified"}:
                self.validate_activated_ownership()
            self.validate_runtime_evidence()
        return sorted(set((item.code, item.path, item.line, item.message, item.identifier) for item in self.findings))


# --- Standalone lane (prd-taskbreaker six-doc lite): root PRD.md, PLAN.md, TASKS.md ---

STANDALONE_SECTIONS: Dict[str, Tuple[str, ...]] = {
    "Problem": ("problem", "overview"),
    "Users": ("users", "product audience and market context"),
    "Goals": ("goals",),
    "Non-goals": ("non goals",),
    "Requirements": ("requirements",),
    "Open questions": ("open questions",),
}
ACCEPTED_STATUSES = {"accepted", "approved", "implemented", "verified"}
REQ_BULLET_RE = re.compile(r"^(\s*)[-*]\s+\*\*(REQ-\d+)\*\*(.*)$")
REQ_HEADING_RE = re.compile(r"^\s*(#{2,6})\s+(?:\[[ xX]\]\s+)?(REQ-\d+)\b(.*)$")
STANDALONE_TASK_RE = re.compile(r"^\s*(#{2,6})\s+(?:\[[ xX]\]\s+)?(TASK-\d+)\b")
TASK_REQUIREMENT_RE = re.compile(r"^\s*[-*]\s+\**\s*(?:primary\s+)?requirement\b\s*:?\s*\**\s*:?\s*(.*)$", re.I)
REQ_ID_RE = re.compile(r"\bREQ-\d+\b")
NOT_APPLICABLE_RE = re.compile(r"^\W*not applicable\b", re.I)
NOT_APPLICABLE_REASON_RE = re.compile(r"^\W*not applicable\s*[—–:-]+\s*\w", re.I)
GIVEN_WHEN_THEN_RE = re.compile(r"\bgiven\b[\s\S]*?\bwhen\b[\s\S]*?\bthen\b", re.I)


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def heading_level(line: str) -> int:
    match = ANY_HEADING_RE.match(line)
    return len(match.group(1)) if match else 0


def table_column_values(lines: Sequence[str], header_names: Set[str]) -> List[Tuple[int, str]]:
    """Cells under any table column whose normalized header is in header_names, reusing the pack table parser."""
    values: List[Tuple[int, str]] = []
    index = 0
    while index + 1 < len(lines):
        headers = split_table_row(lines[index]) if "|" in lines[index] else []
        separator = split_table_row(lines[index + 1]) if "|" in lines[index + 1] else []
        if len(headers) < 2 or len(separator) != len(headers) or not is_separator_row(separator):
            index += 1
            continue
        columns = [position for position, header in enumerate(headers) if normalize_header(header) in header_names]
        row = index + 2
        while row < len(lines) and "|" in lines[row] and lines[row].strip():
            cells = split_table_row(lines[row])
            for position in columns:
                if position < len(cells):
                    values.append((row + 1, cells[position].strip("`* ")))
            row += 1
        index = row
    return values


def role_names(lines: Sequence[str]) -> Dict[str, int]:
    roles: Dict[str, int] = {}
    for line_number, value in table_column_values(lines, {"role", "roles"}):
        if value and not re.match(r"^[\[<{]", value):
            roles.setdefault(value.lower(), line_number)
    return roles


def validate_standalone(repo: Path) -> Tuple[List[Finding], List[Finding], Dict[str, int]]:
    findings: List[Finding] = []
    warnings: List[Finding] = []

    def read(name: str) -> Optional[List[str]]:
        path = repo / name
        if not path.is_file():
            return None
        try:
            return strip_code_fences(path.read_text(encoding="utf-8").splitlines())
        except UnicodeDecodeError as exc:
            findings.append(Finding("MD005", name, 1, f"file is not valid UTF-8: {exc}"))
            return None

    prd = read("PRD.md")
    plan = read("PLAN.md")
    tasks = read("TASKS.md")
    if prd is None:
        if not any(item.code == "MD005" for item in findings):
            findings.append(Finding("PRD001", "PRD.md", 1, "standalone repository has no root PRD.md"))
        return findings, warnings, {"files": 0, "declarations": 0, "tasks": 0}

    # Required sections: present as a level-2 heading with a non-empty body or a reasoned `Not applicable`.
    sections: Dict[str, Tuple[int, List[str]]] = {}
    current: Optional[str] = None
    for line_number, line in enumerate(prd, 1):
        match = re.match(r"^\s*##\s+(.+?)\s*#*\s*$", line)
        if match:
            title = normalize_header(match.group(1))
            current = next(
                (label for label, aliases in STANDALONE_SECTIONS.items()
                 if any(title == alias or title.startswith(alias + " ") for alias in aliases)),
                None,
            )
            if current and current not in sections:
                sections[current] = (line_number, [])
            elif current:
                current = None  # a repeated section heading does not reopen the first one
            continue
        if heading_level(line) == 1:
            current = None
        elif current:
            sections[current][1].append(line)
    for label in STANDALONE_SECTIONS:
        if label not in sections:
            findings.append(Finding("PRD001", "PRD.md", 1, f"required section '{label}' is missing; keep it with 'Not applicable — <reason>' when it does not apply"))
            continue
        line_number, body = sections[label]
        text = "\n".join(item for item in body if item.strip()).strip()
        if not text:
            findings.append(Finding("PRD002", "PRD.md", line_number, f"required section '{label}' is empty"))
        elif NOT_APPLICABLE_RE.match(text) and not NOT_APPLICABLE_REASON_RE.match(text):
            findings.append(Finding("PRD002", "PRD.md", line_number, f"section '{label}' is 'Not applicable' without a reason"))

    document_status = next((match.group(1).lower() for match in (re.match(r"^Status:\s*\**\s*([A-Za-z]+)", line) for line in prd) if match), "")

    # REQ declarations: bold bullets, headings, or table rows whose first cell is the ID.
    requirements: Dict[str, List[Tuple[int, str]]] = {}
    for index, line in enumerate(prd):
        bullet = REQ_BULLET_RE.match(line)
        heading = REQ_HEADING_RE.match(line)
        block = [line]
        if bullet:
            identifier = bullet.group(2)
            for following in prd[index + 1:]:
                if not following.strip():
                    continue
                if indent_of(following) <= len(bullet.group(1)) or ANY_HEADING_RE.match(following):
                    break
                block.append(following)
        elif heading:
            identifier = heading.group(2)
            level = len(heading.group(1))
            for following in prd[index + 1:]:
                if 0 < heading_level(following) <= level or REQ_HEADING_RE.match(following):
                    break
                block.append(following)
        elif line.lstrip().startswith("|") and REQ_ID_RE.fullmatch(split_table_row(line)[0].strip("`* ")):
            identifier = split_table_row(line)[0].strip("`* ")
        else:
            continue
        requirements.setdefault(identifier, []).append((index + 1, "\n".join(block)))

    def requirement_status(block: str) -> str:
        match = re.search(r"\bStatus\b\**\s*:\s*\**\s*([A-Za-z]+)", block)
        return match.group(1).lower() if match else document_status

    accepted: Dict[str, int] = {}
    for identifier, declarations in sorted(requirements.items()):
        if len(declarations) > 1:
            locations = ", ".join(f"PRD.md:{line}" for line, _block in declarations)
            for line, _block in declarations:
                findings.append(Finding("REQ001", "PRD.md", line, f"duplicate declaration for {identifier}; declarations: {locations}", identifier))
        line, block = declarations[0]
        first_line = block.splitlines()[0]
        priority = re.search(r"\*\*REQ-\d+\*\*\s*\(([^)]*)\)|\bPriority\b\**\s*:\s*\**\s*(\w+)", block)
        priority_text = " ".join(group for group in priority.groups() if group) if priority else ""
        table_must = first_line.lstrip().startswith("|") and "must" in {cell.strip("`* ").lower() for cell in split_table_row(first_line)}
        if (re.search(r"\bmust\b", priority_text, re.I) or table_must) and not GIVEN_WHEN_THEN_RE.search(block):
            findings.append(Finding("REQ002", "PRD.md", line, f"Must requirement {identifier} has no Given/When/Then acceptance", identifier))
        if requirement_status(block) in ACCEPTED_STATUSES:
            accepted[identifier] = line

    task_count = 0
    if tasks is not None:
        traced: Set[str] = set()
        for index, line in enumerate(tasks):
            match = STANDALONE_TASK_RE.match(line)
            if not match:
                continue
            task_count += 1
            task_id, level = match.group(2), len(match.group(1))
            field_values: List[str] = []
            for following in tasks[index + 1:]:
                if 0 < heading_level(following) <= level:
                    break
                requirement = TASK_REQUIREMENT_RE.match(following)
                if requirement:
                    field_values.append(requirement.group(1))
            identifiers = [item for value in field_values for item in REQ_ID_RE.findall(value)]
            if not identifiers:
                findings.append(Finding("TASK004", "TASKS.md", index + 1, f"{task_id} has no Requirement naming a REQ-*", task_id))
                continue
            for identifier in dict.fromkeys(identifiers):
                if identifier not in requirements:
                    findings.append(Finding("TASK005", "TASKS.md", index + 1, f"{task_id} requirement {identifier} is not declared in PRD.md", task_id))
            traced.update(identifiers)
        for identifier, line in sorted(accepted.items()):
            if identifier not in traced:
                findings.append(Finding("TRACE002", "PRD.md", line, f"accepted requirement {identifier} has no task in TASKS.md", identifier))

    if plan is not None:
        prd_roles, plan_roles = role_names(prd), role_names(plan)
        if prd_roles and plan_roles:
            for role, line in sorted(prd_roles.items()):
                if role not in plan_roles:
                    warnings.append(Finding("ROLE001", "PRD.md", line, f"role '{role}' has no authorization rule in PLAN.md"))
            for role, line in sorted(plan_roles.items()):
                if role not in prd_roles:
                    warnings.append(Finding("ROLE001", "PLAN.md", line, f"role '{role}' is not named in PRD.md"))

    files = sum(1 for item in (prd, plan, tasks) if item is not None)
    return sorted(findings), sorted(warnings), {"files": files, "declarations": len(requirements), "tasks": task_count}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, nargs="?", help="Markdown specification pack root")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("--stage", choices=STAGES, help="opt in to product stage gates")
    parser.add_argument("--tasks", type=Path, action="append", default=[], metavar="PATH",
                        help="extra execution queue (e.g. repository root TASKS.md); only its T-* task blocks are read; repeatable")
    parser.add_argument("--standalone", type=Path, metavar="REPO",
                        help="validate a standalone repository's root PRD.md, PLAN.md, and TASKS.md (no suite pack)")
    args = parser.parse_args()
    warnings: List[Finding] = []
    if args.standalone:
        if args.root or args.stage or args.tasks:
            parser.error("--standalone takes only REPO and --format")
        repo = args.standalone.expanduser().resolve()
        if not repo.is_dir():
            parser.error(f"not a directory: {repo}")
        if (repo / "docs" / "spec" / "CONTEXT-RECORD.md").is_file():
            parser.error("a development-spec-suite pack exists; validate docs/spec with --tasks TASKS.md instead")
        findings, warnings, counts = validate_standalone(repo)
        summary = {**counts, "findings": len(findings), "warnings": len(warnings)}
    else:
        if not args.root:
            parser.error("a pack root or --standalone REPO is required")
        root = args.root.expanduser().resolve()
        if not root.is_dir():
            parser.error(f"not a directory: {root}")
        task_files = [path.expanduser().resolve() for path in args.tasks]
        for path in task_files:
            if not path.is_file() or not os.access(path, os.R_OK):
                parser.error(f"not a readable file: {path}")

        validator = Validator(root, args.stage, task_files)
        raw_findings = validator.run()
        findings = [Finding(code, path, line, message, identifier) for code, path, line, message, identifier in raw_findings]
        summary = {
            "files": len(validator.files),
            "declarations": len(validator.declarations),
            "tasks": sum(1 for identifier in validator.declarations if identifier.startswith("T-")),
            "findings": len(findings),
        }
    if args.format == "json":
        payload = {"version": 2, "ok": not findings, "summary": summary, "findings": [item.as_dict() for item in findings]}
        if args.standalone:
            payload["warnings"] = [item.as_dict() for item in warnings]
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 1 if findings else 0
    for item in warnings:
        identifier = f" [{item.identifier}]" if item.identifier else ""
        print(f"WARN {item.code} {item.path}:{item.line}{identifier} {item.message}")
    if findings:
        for item in findings:
            identifier = f" [{item.identifier}]" if item.identifier else ""
            print(f"FAIL {item.code} {item.path}:{item.line}{identifier} {item.message}")
        print(f"FAIL files={summary['files']} declarations={summary['declarations']} tasks={summary['tasks']} findings={summary['findings']}")
    else:
        print(f"PASS files={summary['files']} declarations={summary['declarations']} tasks={summary['tasks']} findings=0")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
