#!/usr/bin/env python3
"""Run deterministic structural checks on a Chinese patent disclosure Markdown file."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_CONCEPTS = {
    "题目三板斧": ("题目三板斧", "具体技术问题"),
    "技术领域": ("技术领域",),
    "背景技术": ("背景技术",),
    "发明内容": ("发明内容", "核心技术方案"),
    "方法步骤": ("方法步骤", "技术链"),
    "系统组成": ("系统组成", "系统组件"),
    "实施例": ("实施例", "具体实施方式"),
    "支持矩阵": ("支持矩阵",),
    "待确认事项": ("待确认事项", "问题清单"),
}

RISK_PATTERNS = {
    "未经依据的绝对授权结论": re.compile(r"必然(?:获得|授予|授权)|保证授权|百分之百授权"),
    "疑似虚构精确提升": re.compile(r"(?:提高|提升|降低|减少)\s*\d+(?:\.\d+)?\s*%"),
    "空泛 AI 表述": re.compile(r"(?:采用|使用|通过)(?:了)?(?:人工智能|AI|大模型|机器学习)(?:技术|算法|模型)?(?:进行处理)?(?:，|,)?(?:从而)?(?:提高|提升|优化)"),
    "未解决占位符": re.compile(r"\{\{[^}]+\}\}|\bTODO\b|待补充"),
}


def validate(path: Path) -> tuple[list[str], list[str]]:
    """Return blocking structural errors and non-blocking review warnings."""

    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    warnings: list[str] = []

    for label, alternatives in REQUIRED_CONCEPTS.items():
        if not any(term in text for term in alternatives):
            errors.append(f"缺少必要部分：{label}")

    if "| 输入" not in text and "输入：" not in text and "输入及来源" not in text:
        errors.append("未发现步骤输入字段")
    if "| 输出" not in text and "输出：" not in text and "输出及去向" not in text:
        errors.append("未发现步骤输出字段")
    if not re.search(r"F[1-5]", text):
        warnings.append("未发现 F1—F5 事实状态标记")

    for label, pattern in RISK_PATTERNS.items():
        matches = pattern.findall(text)
        if matches:
            sample = "、".join(dict.fromkeys(matches))[:120]
            warnings.append(f"{label}：{sample}")

    return errors, warnings


def main() -> int:
    """Validate the requested Markdown document and return a CLI exit code."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    args = parser.parse_args()

    if not args.document.is_file():
        print(f"ERROR: 文件不存在：{args.document}", file=sys.stderr)
        return 2

    try:
        errors, warnings = validate(args.document)
    except UnicodeDecodeError:
        print("ERROR: 文件必须是 UTF-8 Markdown", file=sys.stderr)
        return 2

    for item in errors:
        print(f"ERROR: {item}")
    for item in warnings:
        print(f"WARN: {item}")

    if errors:
        print(f"FAIL: {len(errors)} 个错误，{len(warnings)} 个警告")
        return 1
    print(f"PASS: 结构完整，{len(warnings)} 个警告需要人工复核")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
