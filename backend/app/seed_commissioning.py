"""Seed commissioning data: services, asset types, assets, requirement templates."""
import asyncio

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.models.discipline import Discipline
from app.models.service import Service
from app.models.asset_type import AssetType
from app.models.asset import Asset
from app.models.commissioning import RequirementTemplate, AssetRequirement, AssetTagTarget


# --- Services per Discipline (for project 1728) ---
SERVICES = {
    "EL": [
        {"name": "HV Distribution", "code": "HV"},
        {"name": "LV Distribution", "code": "LV"},
        {"name": "UPS Systems", "code": "UPS"},
        {"name": "Generators", "code": "GEN"},
        {"name": "Lighting", "code": "LTG"},
        {"name": "Earthing & Lightning", "code": "ELP"},
        {"name": "Cable Management", "code": "CM"},
    ],
    "MC": [
        {"name": "HVAC", "code": "HVAC"},
        {"name": "Chilled Water", "code": "CHW"},
        {"name": "Hot Water", "code": "HW"},
        {"name": "BMS", "code": "BMS"},
        {"name": "CRAC Units", "code": "CRAC"},
    ],
    "PL": [
        {"name": "Domestic Water", "code": "DW"},
        {"name": "Drainage", "code": "DR"},
    ],
    "FF": [
        {"name": "Fire Alarm", "code": "FA"},
        {"name": "Sprinkler", "code": "SPR"},
        {"name": "FM200 Suppression", "code": "FM200"},
    ],
}

# --- Asset Types per Service ---
ASSET_TYPES = {
    "GEN": [
        {"name": "Generator", "code": "GEN", "subtypes": [
            {"name": "2500kVA Generator", "code": "GEN-2500"},
            {"name": "1250kVA Generator", "code": "GEN-1250"},
        ]},
    ],
    "LV": [
        {"name": "Main Distribution Board", "code": "MDB"},
        {"name": "Distribution Board", "code": "DB"},
        {"name": "Automatic Transfer Switch", "code": "ATS"},
    ],
    "HV": [
        {"name": "HV Switchgear", "code": "HVSW"},
        {"name": "Transformer", "code": "TX"},
    ],
    "UPS": [
        {"name": "UPS Unit", "code": "UPS"},
        {"name": "Static Transfer Switch", "code": "STS"},
        {"name": "UPS Distribution Board", "code": "UPSDB"},
    ],
    "HVAC": [
        {"name": "Air Handling Unit", "code": "AHU"},
        {"name": "Fan Coil Unit", "code": "FCU"},
        {"name": "Extract Fan", "code": "EF"},
    ],
    "CRAC": [
        {"name": "CRAC Unit", "code": "CRAC"},
        {"name": "In-Row Cooling Unit", "code": "IRC"},
    ],
    "CHW": [
        {"name": "Chiller", "code": "CH"},
        {"name": "Chilled Water Pump", "code": "CHWP"},
    ],
    "BMS": [
        {"name": "BMS Panel", "code": "BMSP"},
        {"name": "BMS Controller", "code": "BMSC"},
    ],
    "FA": [
        {"name": "Fire Alarm Panel", "code": "FAP"},
        {"name": "Smoke Detector", "code": "SD"},
    ],
    "FM200": [
        {"name": "FM200 Panel", "code": "FM200P"},
        {"name": "FM200 Cylinder", "code": "FM200C"},
    ],
}

# --- Assets (instances) ---
ASSETS = [
    # Generators
    {"name": "Generator 1", "tag": "GEN-01", "type_code": "GEN-2500"},
    {"name": "Generator 2", "tag": "GEN-02", "type_code": "GEN-2500"},
    {"name": "Generator 3", "tag": "GEN-03", "type_code": "GEN-1250"},
    # LV Distribution
    {"name": "Main Distribution Board 1", "tag": "MDB-01", "type_code": "MDB"},
    {"name": "Main Distribution Board 2", "tag": "MDB-02", "type_code": "MDB"},
    {"name": "Distribution Board 1A", "tag": "DB-1A", "type_code": "DB"},
    {"name": "Distribution Board 1B", "tag": "DB-1B", "type_code": "DB"},
    {"name": "Distribution Board 2A", "tag": "DB-2A", "type_code": "DB"},
    {"name": "ATS-01", "tag": "ATS-01", "type_code": "ATS"},
    {"name": "ATS-02", "tag": "ATS-02", "type_code": "ATS"},
    # HV
    {"name": "HV Switchgear 1", "tag": "HVSW-01", "type_code": "HVSW"},
    {"name": "Transformer 1", "tag": "TX-01", "type_code": "TX"},
    {"name": "Transformer 2", "tag": "TX-02", "type_code": "TX"},
    # UPS
    {"name": "UPS Unit 1", "tag": "UPS-01", "type_code": "UPS"},
    {"name": "UPS Unit 2", "tag": "UPS-02", "type_code": "UPS"},
    {"name": "STS-01", "tag": "STS-01", "type_code": "STS"},
    {"name": "UPS DB 1", "tag": "UPSDB-01", "type_code": "UPSDB"},
    # HVAC
    {"name": "AHU-01", "tag": "AHU-01", "type_code": "AHU"},
    {"name": "AHU-02", "tag": "AHU-02", "type_code": "AHU"},
    {"name": "FCU-01", "tag": "FCU-01", "type_code": "FCU"},
    {"name": "FCU-02", "tag": "FCU-02", "type_code": "FCU"},
    {"name": "FCU-03", "tag": "FCU-03", "type_code": "FCU"},
    {"name": "Extract Fan 1", "tag": "EF-01", "type_code": "EF"},
    # CRAC
    {"name": "CRAC Unit 1", "tag": "CRAC-01", "type_code": "CRAC"},
    {"name": "CRAC Unit 2", "tag": "CRAC-02", "type_code": "CRAC"},
    {"name": "In-Row Cooling 1", "tag": "IRC-01", "type_code": "IRC"},
    {"name": "In-Row Cooling 2", "tag": "IRC-02", "type_code": "IRC"},
    # Chilled Water
    {"name": "Chiller 1", "tag": "CH-01", "type_code": "CH"},
    {"name": "Chiller 2", "tag": "CH-02", "type_code": "CH"},
    {"name": "CHW Pump 1", "tag": "CHWP-01", "type_code": "CHWP"},
    {"name": "CHW Pump 2", "tag": "CHWP-02", "type_code": "CHWP"},
    # BMS
    {"name": "BMS Main Panel", "tag": "BMSP-01", "type_code": "BMSP"},
    {"name": "BMS Controller 1", "tag": "BMSC-01", "type_code": "BMSC"},
    {"name": "BMS Controller 2", "tag": "BMSC-02", "type_code": "BMSC"},
    # Fire
    {"name": "Fire Alarm Panel 1", "tag": "FAP-01", "type_code": "FAP"},
    {"name": "FM200 Panel DC Hall", "tag": "FM200P-01", "type_code": "FM200P"},
    {"name": "FM200 Cylinder 1", "tag": "FM200C-01", "type_code": "FM200C"},
]

# --- Requirement Templates ---
REQUIREMENT_TEMPLATES = [
    # L1 - FAT
    {"name": "Factory Acceptance Test", "code": "FAT", "level": "L1", "category": "fat", "evidence": "FAT", "sort": 1},
    # L2A - Delivery & Placement
    {"name": "Equipment Delivery", "code": "DEL", "level": "L2A", "category": "delivery", "evidence": "MIR", "sort": 1},
    {"name": "Equipment Placement & Anchoring", "code": "PLC", "level": "L2A", "category": "activity", "evidence": "WIR", "sort": 2},
    # L2B - Installation Activities
    {"name": "Power Cable Installation", "code": "PWR-CBL", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 1, "work_breakdown": True},
    {"name": "Control Cable Installation", "code": "CTL-CBL", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 2, "work_breakdown": True},
    {"name": "Cable Termination", "code": "CBL-TERM", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 3, "work_breakdown": True},
    {"name": "Containment Installation", "code": "CONT", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 4},
    {"name": "Earthing Connection", "code": "EARTH", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 5},
    {"name": "Piping Installation", "code": "PIPE", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 6},
    {"name": "Ductwork Installation", "code": "DUCT", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 7},
    {"name": "Insulation", "code": "INSUL", "level": "L2B", "category": "activity", "evidence": "WIR", "sort": 8},
    # L2B - Tests
    {"name": "Insulation Resistance Test", "code": "IR-TEST", "level": "L2B", "category": "test", "evidence": "CIR", "sort": 10},
    {"name": "Continuity Test", "code": "CONT-TEST", "level": "L2B", "category": "test", "evidence": "CIR", "sort": 11},
    {"name": "Pressure Test", "code": "PRESS-TEST", "level": "L2B", "category": "test", "evidence": "CIR", "sort": 12},
    {"name": "Cold Test", "code": "COLD-TEST", "level": "L2B", "category": "test", "evidence": "CIR", "sort": 13},
    # L2B - Final gate
    {"name": "Level 2B Final Inspection", "code": "L2B-FINAL", "level": "L2B", "category": "final_level_test", "evidence": "CIR", "sort": 99, "gate": True},
    # L3 - Standalone Tests
    {"name": "Functional Performance Test", "code": "FPT", "level": "L3", "category": "test", "evidence": "CIR", "sort": 1},
    {"name": "Load Test", "code": "LOAD-TEST", "level": "L3", "category": "test", "evidence": "CIR", "sort": 2},
    {"name": "Protection Relay Test", "code": "PROT-TEST", "level": "L3", "category": "test", "evidence": "CIR", "sort": 3},
    {"name": "Vibration Test", "code": "VIB-TEST", "level": "L3", "category": "test", "evidence": "CIR", "sort": 4},
    {"name": "Noise Level Test", "code": "NOISE-TEST", "level": "L3", "category": "test", "evidence": "CIR", "sort": 5},
    # L4 - Integration Tests
    {"name": "BMS Integration Test", "code": "BMS-INT", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 1},
    {"name": "Power Changeover Test", "code": "PCO-TEST", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 2},
    {"name": "UPS Failover Test", "code": "UPS-FO", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 3},
    {"name": "Fire Suppression Integration Test", "code": "FIRE-INT", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 4},
    {"name": "Cooling Redundancy Test", "code": "COOL-RED", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 5},
    {"name": "Emergency Power Off Test", "code": "EPO-TEST", "level": "L4", "category": "integration_test", "evidence": "CIR", "sort": 6},
]

# Tag mapping
TAG_MAP = {"L1": "red", "L2A": "red", "L2B": "yellow", "L3": "green", "L4": "blue"}


async def get_or_create(session, model, filter_field, filter_value, **kwargs):
    result = await session.execute(select(model).where(getattr(model, filter_field) == filter_value))
    item = result.scalar_one_or_none()
    if item:
        return item, False
    item = model(**{filter_field: filter_value, **kwargs})
    session.add(item)
    await session.flush()
    return item, True


async def seed_commissioning():
    async with async_session_factory() as session:
        # Get project 1728
        result = await session.execute(select(Project).where(Project.code == "1728"))
        proj = result.scalar_one_or_none()
        if not proj:
            print("Project 1728 not found. Run base seed first.")
            return

        # Get disciplines
        disc_result = await session.execute(select(Discipline).where(Discipline.project_id == proj.id))
        disc_map = {d.code: d for d in disc_result.scalars().all()}

        # --- Services ---
        svc_map = {}
        for disc_code, services in SERVICES.items():
            disc = disc_map.get(disc_code)
            if not disc:
                continue
            for s in services:
                svc, created = await get_or_create(session, Service, "code", s["code"], name=s["name"], discipline_id=disc.id)
                svc_map[s["code"]] = svc
                if created:
                    print(f"  Service: {s['code']} - {s['name']}")
        await session.commit()

        # --- Asset Types ---
        type_map = {}
        for svc_code, types in ASSET_TYPES.items():
            svc = svc_map.get(svc_code)
            if not svc:
                continue
            for t in types:
                at, created = await get_or_create(session, AssetType, "code", t["code"], name=t["name"], service_id=svc.id)
                type_map[t["code"]] = at
                if created:
                    print(f"  AssetType: {t['code']} - {t['name']}")
                # Subtypes
                for st in t.get("subtypes", []):
                    sub, sub_created = await get_or_create(session, AssetType, "code", st["code"], name=st["name"], service_id=svc.id, parent_type_id=at.id)
                    type_map[st["code"]] = sub
                    if sub_created:
                        print(f"    Subtype: {st['code']} - {st['name']}")
        await session.commit()

        # --- Assets ---
        asset_map = {}
        for a in ASSETS:
            at = type_map.get(a["type_code"])
            if not at:
                print(f"  WARNING: type {a['type_code']} not found for asset {a['tag']}")
                continue
            asset, created = await get_or_create(session, Asset, "tag_number", a["tag"], name=a["name"], asset_type_id=at.id)
            asset_map[a["tag"]] = asset
            if created:
                print(f"  Asset: {a['tag']} - {a['name']}")
        await session.commit()

        # --- Requirement Templates ---
        tmpl_map = {}
        for rt in REQUIREMENT_TEMPLATES:
            tmpl, created = await get_or_create(
                session, RequirementTemplate, "code", rt["code"],
                name=rt["name"],
                project_id=proj.id,
                level_code=rt["level"],
                requirement_category=rt["category"],
                evidence_document_type=rt["evidence"],
                requires_work_breakdown=rt.get("work_breakdown", False),
                is_gate_requirement=rt.get("gate", False),
                sort_order=rt["sort"],
            )
            tmpl_map[rt["code"]] = tmpl
            if created:
                print(f"  Requirement: [{rt['level']}] {rt['code']} - {rt['name']}")
        await session.commit()

        # --- Assign core requirements to all assets ---
        # Every asset gets: FAT, DEL, PLC (L1/L2A basics)
        # Electrical assets also get cable/termination requirements
        # All assets get L2B final, L3 FPT
        core_reqs = ["FAT", "DEL", "PLC"]
        electrical_reqs = ["PWR-CBL", "CTL-CBL", "CBL-TERM", "CONT", "EARTH", "IR-TEST", "CONT-TEST", "COLD-TEST", "L2B-FINAL", "FPT"]
        mechanical_reqs = ["PIPE", "DUCT", "INSUL", "PRESS-TEST", "COLD-TEST", "L2B-FINAL", "FPT"]

        # Determine which assets are electrical vs mechanical
        el_svc_codes = {"HV", "LV", "UPS", "GEN", "LTG", "ELP", "CM"}
        mc_svc_codes = {"HVAC", "CHW", "HW", "BMS", "CRAC"}

        assigned_count = 0
        for tag, asset in asset_map.items():
            # Find asset type's service
            at = None
            for code, atype in type_map.items():
                if atype.id == asset.asset_type_id:
                    at = atype
                    break
            if not at:
                continue

            # Determine service code
            svc_code = None
            for sc, svc in svc_map.items():
                if svc.id == at.service_id:
                    svc_code = sc
                    break

            # Assign requirements
            req_codes = list(core_reqs)
            if svc_code in el_svc_codes:
                req_codes.extend(electrical_reqs)
            elif svc_code in mc_svc_codes:
                req_codes.extend(mechanical_reqs)
            else:
                req_codes.extend(["L2B-FINAL", "FPT"])

            # Deduplicate
            req_codes = list(dict.fromkeys(req_codes))

            for rc in req_codes:
                tmpl = tmpl_map.get(rc)
                if not tmpl:
                    continue
                # Check if already assigned
                existing = await session.execute(
                    select(AssetRequirement).where(
                        AssetRequirement.asset_id == asset.id,
                        AssetRequirement.requirement_template_id == tmpl.id,
                    )
                )
                if not existing.scalar_one_or_none():
                    session.add(AssetRequirement(
                        asset_id=asset.id,
                        requirement_template_id=tmpl.id,
                        required_for_tag=TAG_MAP[tmpl.level_code],
                    ))
                    assigned_count += 1

        await session.commit()
        print(f"\n  Assigned {assigned_count} requirements to assets.")

        # --- L4 Integration test assignments (multi-asset) ---
        # BMS Integration: all BMS + CRAC + AHU + FCU
        bms_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["BMSP", "BMSC", "CRAC", "IRC", "AHU", "FCU"])]
        # Power Changeover: Generators + ATS + MDB + HV
        pco_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["GEN", "ATS", "MDB", "HVSW", "TX"])]
        # UPS Failover: UPS + STS + UPSDB
        ups_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["UPS", "STS", "UPSDB"])]
        # Fire Suppression: FAP + FM200
        fire_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["FAP", "FM200"])]
        # Cooling Redundancy: Chillers + CRAC + IRC + CHWP
        cool_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["CH-", "CRAC", "IRC", "CHWP"])]
        # EPO: all critical power
        epo_assets = [t for t, a in asset_map.items() if any(t.startswith(p) for p in ["GEN", "UPS", "STS", "MDB", "ATS", "HVSW"])]

        l4_assignments = [
            ("BMS-INT", bms_assets),
            ("PCO-TEST", pco_assets),
            ("UPS-FO", ups_assets),
            ("FIRE-INT", fire_assets),
            ("COOL-RED", cool_assets),
            ("EPO-TEST", epo_assets),
        ]

        l4_count = 0
        for tmpl_code, tags in l4_assignments:
            tmpl = tmpl_map.get(tmpl_code)
            if not tmpl:
                continue
            for tag in tags:
                asset = asset_map.get(tag)
                if not asset:
                    continue
                existing = await session.execute(
                    select(AssetRequirement).where(
                        AssetRequirement.asset_id == asset.id,
                        AssetRequirement.requirement_template_id == tmpl.id,
                    )
                )
                if not existing.scalar_one_or_none():
                    session.add(AssetRequirement(
                        asset_id=asset.id,
                        requirement_template_id=tmpl.id,
                        required_for_tag="blue",
                    ))
                    l4_count += 1

        await session.commit()
        print(f"  Assigned {l4_count} L4 integration test requirements.")
        print("\nCommissioning seed complete.")


if __name__ == "__main__":
    asyncio.run(seed_commissioning())
