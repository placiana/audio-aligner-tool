#!/usr/bin/env python3
"""
migrate_to_v2.py
----------------
Migrate legacy alignment/multimodal projects from V1 to the V2 Multichannel schema.

Supports:
  - Cloning to a new V2 project (recommended, keeps V1 untouched)
  - In-place conversion (updates project type to multichannel_v2)
  - Dry-run preview mode
  - Preserving all audio/text segments, matches, and collaborators
  - Multilingual translations if present in segment['texts']

Usage:
  python migrate_to_v2.py                     # Interactive mode
  python migrate_to_v2.py --all --mode clone  # Migrate all V1 projects (clone)
  python migrate_to_v2.py --project-id 1      # Migrate project 1
  python migrate_to_v2.py --help              # Show help
"""

import os
import sys
import json
import shutil
import sqlite3
import argparse
from datetime import datetime


def find_database_path(custom_path=None):
    if custom_path and os.path.exists(custom_path):
        return custom_path
    env_db = os.environ.get('DATABASE_FILE')
    if env_db and os.path.exists(env_db):
        return env_db
    for candidate in ['db/aligner.db', 'aligner.db']:
        if os.path.exists(candidate):
            return candidate
    return 'aligner.db'


def find_uploads_dir(custom_path=None):
    if custom_path and os.path.isdir(custom_path):
        return custom_path
    for candidate in ['uploads', '/app/uploads']:
        if os.path.isdir(candidate):
            return candidate
    return 'uploads'


def get_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def list_migratable_projects(conn):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.name, p.type, p.user_id, u.username as owner,
               (SELECT COUNT(*) FROM audio_items WHERE project_id = p.id) as item_count
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.type != 'multichannel_v2'
        ORDER BY p.id ASC
    """)
    return [dict(r) for r in cursor.fetchall()]


def ensure_file_in_uploads(uploads_dir, relative_or_absolute_path):
    """
    Ensures that a file referenced in audio_items exists in uploads/
    Returns the resolved filename relative to uploads/ for V2 media.
    """
    if not relative_or_absolute_path:
        return ""

    clean_path = relative_or_absolute_path.strip().lstrip('/')
    target_in_uploads = os.path.join(uploads_dir, clean_path)

    # 1. Check if it already exists exactly where clean_path says
    if os.path.exists(target_in_uploads):
        base_name = os.path.basename(clean_path)
        flat_in_uploads = os.path.join(uploads_dir, base_name)
        # If flat path does not exist, copy or hardlink for maximum V2 URL compatibility
        if not os.path.exists(flat_in_uploads):
            try:
                shutil.copy2(target_in_uploads, flat_in_uploads)
            except Exception:
                pass
        return base_name

    # 2. Check flat in uploads/
    base_name = os.path.basename(clean_path)
    flat_in_uploads = os.path.join(uploads_dir, base_name)
    if os.path.exists(flat_in_uploads):
        return base_name

    # 3. Search anywhere inside uploads/
    for root, _, files in os.walk(uploads_dir):
        if base_name in files:
            found_path = os.path.join(root, base_name)
            if not os.path.exists(flat_in_uploads):
                try:
                    shutil.copy2(found_path, flat_in_uploads)
                except Exception:
                    pass
            return base_name

    return base_name or clean_path


def migrate_project(conn, project_id, uploads_dir, mode='clone', dry_run=False):
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    orig_proj = cursor.fetchone()
    if not orig_proj:
        raise ValueError(f"Project with ID {project_id} not found.")

    orig_proj = dict(orig_proj)
    if orig_proj['type'] == 'multichannel_v2' and mode != 'clone':
        print(f"  [i] Project '{orig_proj['name']}' is already multichannel_v2.")
        return orig_proj['id']

    cursor.execute("SELECT * FROM audio_items WHERE project_id = ? ORDER BY id ASC", (project_id,))
    audio_items = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT * FROM project_collaborators WHERE project_id = ?", (project_id,))
    collaborators = [dict(r) for r in cursor.fetchall()]

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Migrating Project {project_id}: '{orig_proj['name']}' ({orig_proj['type']})")
    print(f"  Tracks / Items: {len(audio_items)}")
    print(f"  Collaborators:  {len(collaborators)}")
    print(f"  Mode:           {mode.upper()}")

    if dry_run:
        total_segs = 0
        for item in audio_items:
            try:
                st = json.loads(item['state_json'])
                total_segs += len(st.get('segments', []))
            except Exception:
                pass
        print(f"  [Dry Run] Total segments to migrate across {len(audio_items)} tracks: {total_segs}")
        return project_id

    # Detect if any segments have translation tracks
    translation_langs = set()
    for item in audio_items:
        try:
            st = json.loads(item['state_json'])
            for seg in st.get('segments', []):
                texts = seg.get('texts')
                if isinstance(texts, dict):
                    for k in texts.keys():
                        clean_lang = k.replace('trans_', '').upper()
                        if clean_lang:
                            translation_langs.add(clean_lang)
        except Exception:
            pass

    target_project_id = None
    if mode == 'clone':
        new_name = f"[V2] {orig_proj['name']}"
        cursor.execute(
            "INSERT INTO projects (name, description, type, user_id) VALUES (?, ?, 'multichannel_v2', ?)",
            (new_name, orig_proj['description'] or '', orig_proj['user_id'])
        )
        target_project_id = cursor.lastrowid
        print(f"  Created new V2 project with ID {target_project_id}: '{new_name}'")

        # Copy collaborators
        for c in collaborators:
            try:
                cursor.execute(
                    "INSERT INTO project_collaborators (project_id, user_id, role) VALUES (?, ?, ?)",
                    (target_project_id, c['user_id'], c['role'])
                )
            except sqlite3.IntegrityError:
                pass
    else: # inplace
        target_project_id = project_id
        cursor.execute("UPDATE projects SET type = 'multichannel_v2' WHERE id = ?", (target_project_id,))
        # Clear existing V2 data for this project if any
        cursor.execute("DELETE FROM v2_matches WHERE project_id = ?", (target_project_id,))
        cursor.execute("DELETE FROM v2_channels WHERE project_id = ?", (target_project_id,))
        print(f"  Converted project ID {target_project_id} in-place to 'multichannel_v2'")

    # Create Channel 1: Audio
    cursor.execute(
        "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, 1, 'Audio', 'audio', 0)",
        (target_project_id,)
    )
    ch_audio_id = cursor.lastrowid

    # Create Channel 2: Transcripción
    cursor.execute(
        "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, 2, 'Transcripción', 'transcript', 1)",
        (target_project_id,)
    )
    ch_text_id = cursor.lastrowid

    # Create Translation Channels if present
    trans_channels = {}
    for idx, lang in enumerate(sorted(translation_langs)):
        ch_order = 2 + idx
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, 'translation', ?)",
            (target_project_id, ch_order + 1, f"Traducción ({lang})", ch_order)
        )
        trans_channels[lang] = cursor.lastrowid

    # Migrate each audio_item as media + segments + matches
    total_migrated_segments = 0
    total_migrated_matches = 0

    for item_idx, item in enumerate(audio_items):
        try:
            state = json.loads(item['state_json'])
        except Exception:
            state = {}

        segments = state.get('segments', [])

        # Resolve filenames
        audio_fn = ensure_file_in_uploads(uploads_dir, item['audio_path'])
        text_fn = ensure_file_in_uploads(uploads_dir, item['text_path'])

        if not text_fn and audio_fn:
            base_no_ext = os.path.splitext(audio_fn)[0]
            text_fn = f"{base_no_ext}.txt"

        audio_status = 'segmented' if segments else 'raw'
        text_status = 'segmented' if segments else 'raw'

        # Insert Audio Media
        cursor.execute(
            "INSERT INTO v2_media (channel_id, json_media_id, filename, media_type, status) VALUES (?, ?, ?, 'audio', ?)",
            (ch_audio_id, item_idx + 1, audio_fn, audio_status)
        )
        audio_media_id = cursor.lastrowid

        # Insert Text Media
        cursor.execute(
            "INSERT INTO v2_media (channel_id, json_media_id, filename, media_type, status) VALUES (?, ?, ?, 'text', ?)",
            (ch_text_id, item_idx + 1, text_fn, text_status)
        )
        text_media_id = cursor.lastrowid

        # Insert Translation Media if needed
        trans_media_ids = {}
        for lang, trans_ch_id in trans_channels.items():
            base_no_ext = os.path.splitext(audio_fn)[0] if audio_fn else f"track_{item_idx+1}"
            trans_fn = f"{base_no_ext}_{lang.lower()}.txt"
            cursor.execute(
                "INSERT INTO v2_media (channel_id, json_media_id, filename, media_type, status) VALUES (?, ?, ?, 'translation', ?)",
                (trans_ch_id, item_idx + 1, trans_fn, 'segmented' if segments else 'raw')
            )
            trans_media_ids[lang] = cursor.lastrowid

        # Migrate Segments & Create Matches
        for seg_idx, seg in enumerate(segments):
            start_val = float(seg['start']) if seg.get('start') is not None else 0.0
            end_val = float(seg['end']) if seg.get('end') is not None else 0.0
            text_val = seg.get('text', '') or ''
            json_seg_id = seg_idx + 1

            # Audio Segment
            cursor.execute(
                """INSERT INTO v2_segments 
                   (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order)
                   VALUES (?, ?, ?, ?, ?, NULL, ?)""",
                (ch_audio_id, audio_media_id, json_seg_id, start_val, end_val, seg_idx)
            )
            seg_audio_id = cursor.lastrowid

            # Text Segment
            cursor.execute(
                """INSERT INTO v2_segments 
                   (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order)
                   VALUES (?, ?, ?, NULL, NULL, ?, ?)""",
                (ch_text_id, text_media_id, json_seg_id, text_val, seg_idx)
            )
            seg_text_id = cursor.lastrowid

            # Create Match Group
            cursor.execute("INSERT INTO v2_matches (project_id) VALUES (?)", (target_project_id,))
            match_id = cursor.lastrowid

            # Link Audio Segment
            cursor.execute(
                """INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id)
                   VALUES (?, ?, ?, ?)""",
                (match_id, seg_audio_id, ch_audio_id, audio_media_id)
            )

            # Link Text Segment
            cursor.execute(
                """INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id)
                   VALUES (?, ?, ?, ?)""",
                (match_id, seg_text_id, ch_text_id, text_media_id)
            )

            # Link Translation Segments if present
            extra_texts = seg.get('texts') or {}
            for lang, trans_media_id in trans_media_ids.items():
                lang_key = f"trans_{lang.lower()}"
                lang_text = extra_texts.get(lang_key, '')
                if lang_text:
                    cursor.execute(
                        """INSERT INTO v2_segments 
                           (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order)
                           VALUES (?, ?, ?, NULL, NULL, ?, ?)""",
                        (trans_channels[lang], trans_media_id, json_seg_id, lang_text, seg_idx)
                    )
                    seg_trans_id = cursor.lastrowid
                    cursor.execute(
                        """INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id)
                           VALUES (?, ?, ?, ?)""",
                        (match_id, seg_trans_id, trans_channels[lang], trans_media_id)
                    )

            total_migrated_segments += 2 + (1 if extra_texts else 0)
            total_migrated_matches += 1

    conn.commit()
    print(f"  [OK] Successfully migrated:")
    print(f"       Channels:        {2 + len(trans_channels)}")
    print(f"       Media files:     {len(audio_items) * 2}")
    print(f"       Segments:        {total_migrated_segments}")
    print(f"       Matches linked:  {total_migrated_matches}")
    return target_project_id


def interactive_menu(conn, uploads_dir):
    projects = list_migratable_projects(conn)
    if not projects:
        print("\nNo se encontraron proyectos V1 ('alignment' o 'segmentation') para migrar.")
        print("Todos los proyectos ya son 'multichannel_v2'.")
        return

    print("\n" + "="*60)
    print("  MIGRACIÓN DE PROYECTOS V1 -> V2 MULTICANAL")
    print("="*60)
    print(f"{'ID':<5} {'TIPO':<15} {'ITEMS':<8} {'NOMBRE':<30}")
    print("-" * 60)
    for p in projects:
        print(f"{p['id']:<5} {p['type']:<15} {p['item_count']:<8} {p['name']:<30}")
    print("-" * 60)

    try:
        choice = input("\nIngrese el ID del proyecto a migrar (o 'all' para todos, 'q' para salir): ").strip().lower()
    except (KeyboardInterrupt, EOFError):
        print("\nOperación cancelada.")
        return

    if choice in ['q', 'quit', 'exit']:
        return

    mode_choice = input("Modo de migración [1: Clonar (recomendado), 2: Convertir en el lugar]: ").strip()
    mode = 'inplace' if mode_choice == '2' else 'clone'

    if choice == 'all':
        for p in projects:
            migrate_project(conn, p['id'], uploads_dir, mode=mode, dry_run=False)
    else:
        try:
            pid = int(choice)
            migrate_project(conn, pid, uploads_dir, mode=mode, dry_run=False)
        except ValueError:
            print(f"ID inválido: '{choice}'")


def main():
    parser = argparse.ArgumentParser(description="Migrate V1 alignment projects to V2 multichannel schema.")
    parser.add_argument("--db", help="Path to SQLite database (default: auto-detected)")
    parser.add_argument("--uploads", help="Path to uploads directory (default: uploads)")
    parser.add_argument("--project-id", type=int, help="Project ID to migrate")
    parser.add_argument("--all", action="store_true", help="Migrate all V1 projects")
    parser.add_argument("--mode", choices=['clone', 'inplace'], default='clone',
                        help="clone (create [V2] copy, default) or inplace (update existing)")
    parser.add_argument("--dry-run", action="store_true", help="Preview migration without modifying database")

    args = parser.parse_args()

    db_path = find_database_path(args.db)
    uploads_dir = find_uploads_dir(args.uploads)

    if not os.path.exists(db_path):
        print(f"Error: Base de datos no encontrada en '{db_path}'.", file=sys.stderr)
        sys.exit(1)

    print(f"Base de datos: {db_path}")
    print(f"Directorio uploads: {uploads_dir}")

    conn = get_connection(db_path)

    try:
        if args.project_id:
            migrate_project(conn, args.project_id, uploads_dir, mode=args.mode, dry_run=args.dry_run)
        elif args.all:
            projects = list_migratable_projects(conn)
            if not projects:
                print("No hay proyectos V1 para migrar.")
            for p in projects:
                migrate_project(conn, p['id'], uploads_dir, mode=args.mode, dry_run=args.dry_run)
        else:
            interactive_menu(conn, uploads_dir)
    finally:
        conn.close()


if __name__ == '__main__':
    main()

