import ast
import os
from typing import Dict, List, Tuple, Set
from pathlib import Path

# Структуры: nodes: list of dict {id, label, type, file}
# edges: list of dict {source, target, label?}

class Definition:
    def __init__(self, fqname: str, short: str, typ: str, file: str, lineno: int):
        self.fqname = fqname  # module.path:Name or module.path.Class.method
        self.short = short    # Name or method
        self.typ = typ        # "class" or "function" or "method"
        self.file = file
        self.lineno = lineno

def iter_py_files(root: str):
    for p in Path(root).rglob("*.py"):
        # пропускаем виртуальные окружения и .git
        if "/.venv/" in str(p) or "/venv/" in str(p) or "/.git/" in str(p):
            continue
        yield p

class RepoAnalyzer:
    def __init__(self, repo_root: str):
        self.root = repo_root
        self.defs: Dict[str, Definition] = {}  # key fqname -> Definition
        self.by_short: Dict[str, Set[str]] = {}  # short name -> set of fqnames
        self.edges: Set[Tuple[str,str]] = set()

    def analyze(self):
        # первый проход: собрать определения
        for file in iter_py_files(self.root):
            self._collect_defs(file)
        # второй проход: собрать использования
        for file in iter_py_files(self.root):
            self._collect_uses(file)

    def _module_name(self, path: Path) -> str:
        try:
            rel = path.relative_to(self.root)
        except Exception:
            rel = path
        parts = list(rel.with_suffix('').parts)
        # join with dot
        return ".".join(parts)

    def _collect_defs(self, filepath: Path):
        try:
            source = filepath.read_text(encoding='utf-8')
        except Exception:
            return
        try:
            tree = ast.parse(source)
        except Exception:
            return
        mod = self._module_name(filepath)
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                fq = f"{mod}.{node.name}"
                d = Definition(fq, node.name, "class", str(filepath), node.lineno)
                self.defs[fq] = d
                self.by_short.setdefault(node.name, set()).add(fq)
                # collect methods
                for body in node.body:
                    if isinstance(body, ast.FunctionDef):
                        fqm = f"{fq}.{body.name}"
                        dm = Definition(fqm, body.name, "method", str(filepath), body.lineno)
                        self.defs[fqm] = dm
                        self.by_short.setdefault(body.name, set()).add(fqm)
            elif isinstance(node, ast.FunctionDef):
                # top-level function
                # ensure not methods (methods already handled by ClassDef)
                if isinstance(getattr(node, 'parent', None), ast.ClassDef):
                    continue
                fq = f"{mod}.{node.name}"
                d = Definition(fq, node.name, "function", str(filepath), node.lineno)
                self.defs[fq] = d
                self.by_short.setdefault(node.name, set()).add(fq)

    def _collect_uses(self, filepath: Path):
        try:
            source = filepath.read_text(encoding='utf-8')
        except Exception:
            return
        try:
            tree = ast.parse(source)
        except Exception:
            return

        # Attach parents to detect current scope easily
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                child.parent = node

        # helper to determine current definition context: nearest FunctionDef or ClassDef parent
        def current_context(n):
            p = n
            while hasattr(p, 'parent'):
                p = p.parent
                if isinstance(p, ast.FunctionDef):
                    # if method, find containing class for fqname
                    # try to find class parent
                    cls = getattr(p, 'parent', None)
                    if isinstance(cls, ast.ClassDef):
                        # create potential fq for method: module.Class.method
                        # Need module name
                        # find file's module prefix
                        return ("method", cls.name, p.name, cls.lineno, p.lineno)
                    return ("function", None, p.name, None, p.lineno)
                if isinstance(p, ast.ClassDef):
                    return ("class", p.name, None, p.lineno, None)
            return (None, None, None, None, None)

        mod = self._module_name(filepath)

        class UseVisitor(ast.NodeVisitor):
            def __init__(self, outer: 'RepoAnalyzer'):
                self.outer = outer
                super().__init__()

            def visit_Call(self, node: ast.Call):
                # calls: func can be Name or Attribute
                target_names = []
                if isinstance(node.func, ast.Name):
                    target_names.append(node.func.id)
                elif isinstance(node.func, ast.Attribute):
                    # attribute chain, collect attr and possibly value id
                    if isinstance(node.func.attr, str):
                        target_names.append(node.func.attr)
                    # also if value is Name, include that
                    if isinstance(node.func.value, ast.Name):
                        target_names.append(node.func.value.id)
                # register edges from current context to any defs matching these short names
                ctx = current_context(node)
                source_fq = outer_context_fq(ctx, mod)
                for tn in target_names:
                    outer_link_by_short(source_fq, tn)
                self.generic_visit(node)

            def visit_Attribute(self, node: ast.Attribute):
                # attribute access may reference method/class names
                # e.g. SomeClass.some_method or instance.method
                # check attr
                if isinstance(node.attr, str):
                    ctx = current_context(node)
                    source_fq = outer_context_fq(ctx, mod)
                    outer_link_by_short(source_fq, node.attr)
                self.generic_visit(node)

            def visit_Name(self, node: ast.Name):
                # name usage may be reference to class or function
                # skip if it's a store (assignment target)
                if isinstance(node.ctx, (ast.Load, ast.Del)):
                    ctx = current_context(node)
                    source_fq = outer_context_fq(ctx, mod)
                    outer_link_by_short(source_fq, node.id)
                self.generic_visit(node)

        def outer_link_by_short(source_fq, short_name):
            if not source_fq:
                return
            if short_name in self.by_short:
                targets = self.by_short[short_name]
                for t in targets:
                    if t != source_fq:
                        self.edges.add((source_fq, t))

        def outer_context_fq(ctx, module_name):
            # ctx is tuple returned above
            kind = ctx[0]
            if kind == "method":
                cls_name = ctx[1]; func_name = ctx[2]
                # try to resolve to a fqname
                # prefer module.Class.func
                candidate = f"{module_name}.{cls_name}.{func_name}"
                if candidate in self.defs:
                    return candidate
                # fallback: try any matching method short name in same class
                # or fallback to module.function
                # attempt common possibilities
                candidate2 = f"{module_name}.{func_name}"
                if candidate2 in self.defs:
                    return candidate2
                # else just return module.class (class context)
                candidate3 = f"{module_name}.{cls_name}"
                if candidate3 in self.defs:
                    return candidate3
                # otherwise unknown
                return None
            elif kind == "function":
                func_name = ctx[2]
                candidate = f"{module_name}.{func_name}"
                if candidate in self.defs:
                    return candidate
                return None
            elif kind == "class":
                cls_name = ctx[1]
                candidate = f"{module_name}.{cls_name}"
                if candidate in self.defs:
                    return candidate
                return None
            else:
                # top-level code (module-level): create pseudo-node for module? We'll treat module as source if any defs in file found
                # choose first def in this module as context, otherwise None
                for k in self.defs.keys():
                    if k.startswith(f"{module_name}."):
                        return k  # coarse fallback
                return None

        visitor = UseVisitor(self)
        try:
            visitor.visit(tree)
        except Exception:
            pass

    def to_json(self):
        nodes = []
        # map fq to id
        id_map = {}
        for i, (fq, d) in enumerate(sorted(self.defs.items())):
            nid = str(i)
            id_map[fq] = nid
            nodes.append({
                "id": nid,
                "fqname": fq,
                "label": d.fqname.split('.')[-1],
                "type": d.typ,
                "file": d.file,
                "lineno": d.lineno,
            })
        edges = []
        for (s, t) in sorted(self.edges):
            if s in id_map and t in id_map:
                edges.append({
                    "source": id_map[s],
                    "target": id_map[t],
                    "label": ""
                })
        return {"nodes": nodes, "edges": edges}
