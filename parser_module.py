# parser_module.py
import ast
import os
from pathlib import Path
from collections import defaultdict

class Definition:
    def __init__(self, name, kind, file, lineno, qualname=None):
        self.name = name
        self.kind = kind  # "class" or "function" or "module"
        self.file = file
        self.lineno = lineno
        self.qualname = qualname or name
        self.id = f"{file}:{name}:{lineno}"

def analyze_python_repo(path: str):
    """
    Walk repository under path, parse .py files with ast,
    collect definitions (classes/functions) and simple usage edges.
    Returns JSON-serializable dict: { nodes: [...], links: [...] } suitable for frontend.
    """
    defs = {}
    name_index = defaultdict(list)
    file_trees = {}

    # Collect .py ASTs and definitions
    for py in Path(path).rglob("*.py"):
        try:
            text = py.read_text(encoding='utf-8')
        except Exception:
            continue
        try:
            tree = ast.parse(text)
        except Exception:
            # skip unparsable files
            continue
        file_trees[str(py)] = tree
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                d = Definition(name=node.name, kind="class", file=str(py), lineno=node.lineno)
                defs[d.id] = d
                name_index[node.name].append(d.id)
            elif isinstance(node, ast.FunctionDef):
                d = Definition(name=node.name, kind="function", file=str(py), lineno=node.lineno)
                defs[d.id] = d
                name_index[node.name].append(d.id)

    # Find usage edges
    edges = set()

    for file, tree in file_trees.items():
        class DefVisitor(ast.NodeVisitor):
            def __init__(self, file_path):
                self.context_stack = []
                self.file_path = file_path

            def _record_name_usage(self, name):
                if name in name_index:
                    for target_id in name_index[name]:
                        if self.context_stack:
                            from_id = self.context_stack[-1]
                        else:
                            from_id = f"{self.file_path}:<module>:0"
                            if from_id not in defs:
                                defs[from_id] = Definition(name="<module>", kind="module", file=self.file_path, lineno=0)
                        edges.add((from_id, target_id))

            def visit_FunctionDef(self, node):
                candidate = None
                for d_id in name_index.get(node.name, []):
                    if defs[d_id].file == self.file_path and defs[d_id].lineno == node.lineno:
                        candidate = d_id
                        break
                if candidate is None:
                    for d_id in name_index.get(node.name, []):
                        if defs[d_id].file == self.file_path:
                            candidate = d_id
                            break
                if candidate is None:
                    candidate = f"{self.file_path}:<anon_func>:{node.lineno}"
                    defs[candidate] = Definition(name=node.name, kind="function", file=self.file_path, lineno=node.lineno)
                self.context_stack.append(candidate)
                self.generic_visit(node)
                self.context_stack.pop()

            def visit_ClassDef(self, node):
                candidate = None
                for d_id in name_index.get(node.name, []):
                    if defs[d_id].file == self.file_path and defs[d_id].lineno == node.lineno:
                        candidate = d_id
                        break
                if candidate is None:
                    for d_id in name_index.get(node.name, []):
                        if defs[d_id].file == self.file_path:
                            candidate = d_id
                            break
                if candidate is None:
                    candidate = f"{self.file_path}:<anon_class>:{node.lineno}"
                    defs[candidate] = Definition(name=node.name, kind="class", file=self.file_path, lineno=node.lineno)
                self.context_stack.append(candidate)
                self.generic_visit(node)
                self.context_stack.pop()

            def visit_Call(self, node):
                func = node.func
                if isinstance(func, ast.Name):
                    self._record_name_usage(func.id)
                elif isinstance(func, ast.Attribute):
                    # record attribute/method name
                    self._record_name_usage(func.attr)
                self.generic_visit(node)

            def visit_Attribute(self, node):
                if isinstance(node.attr, str):
                    self._record_name_usage(node.attr)
                self.generic_visit(node)

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    self._record_name_usage(node.id)
                self.generic_visit(node)

        v = DefVisitor(file)
        v.visit(tree)

    # Build node list and links with indices
    nodes = []
    id_to_idx = {}
    for i, (d_id, d) in enumerate(defs.items()):
        id_to_idx[d_id] = i
        nodes.append({
            "id": d_id,
            "label": d.name,
            "kind": d.kind,
            "file": os.path.relpath(d.file, path) if d.file else d.file,
            "lineno": d.lineno
        })

    links = []
    for a, b in edges:
        if a in id_to_idx and b in id_to_idx and a != b:
            links.append({"source": id_to_idx[a], "target": id_to_idx[b]})

    return {"nodes": nodes, "links": links}
