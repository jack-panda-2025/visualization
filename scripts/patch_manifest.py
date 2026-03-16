#!/usr/bin/env python3
"""
patch_manifest.py
-----------------
Reads global energy data from a LS-DYNA d3plot file and appends it
to the existing output/manifest.json.

Adds the following top-level key:

  "energy": {
    "times":    [...],   // simulation times (s)
    "kinetic":  [...],   // kinetic energy at each time (J or model units)
    "internal": [...],   // internal energy
    "total":    [...]    // total energy (kinetic + internal)
  }

Usage
-----
  python patch_manifest.py                      # uses defaults below
  python patch_manifest.py --d3plot /path/to/d3plot --output /path/to/output

Dependencies
------------
  pip install lasso-python          # Lasso FEM I/O library
  # or:
  pip install d3plot                # alternative minimal reader
"""

import argparse
import json
import os
import sys

# ---------------------------------------------------------------------------
# Parse CLI arguments
# ---------------------------------------------------------------------------
def parse_args():
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(
        description="Add global energy curves from d3plot to manifest.json"
    )
    parser.add_argument(
        "--d3plot",
        default=os.path.join(ROOT, "d3plot"),
        help="Path to the d3plot master file (default: <project_root>/d3plot)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(ROOT, "output"),
        help="Path to the output directory containing manifest.json (default: <project_root>/output)",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Try to read energy using lasso-python
# ---------------------------------------------------------------------------
def read_energy_lasso(d3plot_path):
    """
    Returns dict { times, kinetic, internal, total } using lasso-python.
    Raises ImportError if lasso is not installed.
    """
    from lasso.dyna import D3plot, ArrayType

    print(f"  Reading d3plot with lasso: {d3plot_path}")
    d3 = D3plot(d3plot_path)

    times    = d3.arrays.get(ArrayType.global_timesteps, None)
    ke       = d3.arrays.get(ArrayType.global_kinetic_energy, None)
    ie       = d3.arrays.get(ArrayType.global_internal_energy, None)

    if times is None:
        raise RuntimeError("lasso: global_timesteps not found in d3plot")

    times_l = times.tolist()
    ke_l    = ke.tolist()    if ke is not None else [0.0] * len(times_l)
    ie_l    = ie.tolist()    if ie is not None else [0.0] * len(times_l)
    tot_l   = [k + i for k, i in zip(ke_l, ie_l)]

    return dict(times=times_l, kinetic=ke_l, internal=ie_l, total=tot_l)


# ---------------------------------------------------------------------------
# Fallback: try d3plot package
# ---------------------------------------------------------------------------
def read_energy_d3plot_pkg(d3plot_path):
    """
    Returns dict using the 'd3plot' pip package (limited energy support).
    """
    import d3plot as dp

    print(f"  Reading d3plot with d3plot package: {d3plot_path}")
    reader = dp.D3plot(d3plot_path)

    times = reader.timesteps.tolist()

    # d3plot package stores global energy under different attribute names
    ke, ie = [], []
    for t_idx in range(len(times)):
        state = reader.state(t_idx)
        ke.append(float(getattr(state, 'global_kinetic_energy', 0) or 0))
        ie.append(float(getattr(state, 'global_internal_energy', 0) or 0))

    tot = [k + i for k, i in zip(ke, ie)]
    return dict(times=times, kinetic=ke, internal=ie, total=tot)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = parse_args()

    manifest_path = os.path.join(args.output, "manifest.json")
    if not os.path.isfile(manifest_path):
        print(f"ERROR: manifest.json not found at {manifest_path}", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.d3plot):
        print(f"ERROR: d3plot not found at {args.d3plot}", file=sys.stderr)
        sys.exit(1)

    print("Loading manifest…")
    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    if "energy" in manifest:
        print("manifest.json already contains 'energy'. Re-patching…")

    # Try readers in order of preference
    energy = None
    errors = []

    try:
        energy = read_energy_lasso(args.d3plot)
        print("  → Used lasso-python reader.")
    except ImportError:
        errors.append("lasso-python not installed (pip install lasso-python)")
    except Exception as exc:
        errors.append(f"lasso failed: {exc}")

    if energy is None:
        try:
            energy = read_energy_d3plot_pkg(args.d3plot)
            print("  → Used d3plot package reader.")
        except ImportError:
            errors.append("d3plot package not installed (pip install d3plot)")
        except Exception as exc:
            errors.append(f"d3plot pkg failed: {exc}")

    if energy is None:
        print("\nCould not read energy data. Errors encountered:", file=sys.stderr)
        for e in errors:
            print(f"  • {e}", file=sys.stderr)
        print(
            "\nFalling back to zero energy (viewer will show empty chart).",
            file=sys.stderr,
        )
        # Build placeholder from manifest frame times so the chart still draws axes
        frame_times = [fr["time"] for fr in manifest.get("frames", [])]
        energy = dict(
            times=frame_times,
            kinetic=[0.0] * len(frame_times),
            internal=[0.0] * len(frame_times),
            total=[0.0] * len(frame_times),
        )

    manifest["energy"] = energy

    # Pretty-print summary
    n = len(energy["times"])
    t0, t1 = energy["times"][0], energy["times"][-1]
    ke_max = max(energy["kinetic"])  if energy["kinetic"]  else 0
    ie_max = max(energy["internal"]) if energy["internal"] else 0
    print(f"\nEnergy data summary:")
    print(f"  Time range  : {t0:.4f} – {t1:.4f} s  ({n} samples)")
    print(f"  Max KE      : {ke_max:.4e}")
    print(f"  Max IE      : {ie_max:.4e}")

    # Write back
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nPatched manifest written to: {manifest_path}")


if __name__ == "__main__":
    main()
