import os
import sqlite3
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

DATABASE_FILE = os.environ.get('DATABASE_FILE', 'aligner.db')

def get_db_connection():
    db_dir = os.path.dirname(DATABASE_FILE)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    
    # Projects Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL DEFAULT 'alignment',
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ''')
    
    # Collaborators Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_collaborators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ''')
    
    # AudioItems Table (Audio/Text Alignment entities)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS audio_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            audio_path TEXT NOT NULL,
            text_path TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    ''')

    # --- Module V2 Relational Schema ---
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS v2_channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            json_channel_id INTEGER,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            channel_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS v2_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER NOT NULL,
            json_media_id INTEGER,
            filename TEXT NOT NULL,
            media_type TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (channel_id) REFERENCES v2_channels(id) ON DELETE CASCADE
        );
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS v2_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER NOT NULL,
            media_id INTEGER NOT NULL,
            json_segment_id INTEGER,
            start_time REAL,
            end_time REAL,
            text_content TEXT,
            segment_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (channel_id) REFERENCES v2_channels(id) ON DELETE CASCADE,
            FOREIGN KEY (media_id) REFERENCES v2_media(id) ON DELETE CASCADE
        );
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS v2_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS v2_match_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            segment_id INTEGER NOT NULL,
            channel_id INTEGER NOT NULL,
            media_id INTEGER NOT NULL,
            FOREIGN KEY (match_id) REFERENCES v2_matches(id) ON DELETE CASCADE,
            FOREIGN KEY (segment_id) REFERENCES v2_segments(id) ON DELETE CASCADE,
            FOREIGN KEY (channel_id) REFERENCES v2_channels(id) ON DELETE CASCADE,
            FOREIGN KEY (media_id) REFERENCES v2_media(id) ON DELETE CASCADE
        );
    ''')
    
    # Migration checks for existing databases
    cursor.execute("PRAGMA table_info(v2_media);")
    media_cols = [row['name'] for row in cursor.fetchall()]
    if 'status' not in media_cols:
        cursor.execute("ALTER TABLE v2_media ADD COLUMN status TEXT DEFAULT 'raw';")

    # Check if 'is_admin' column exists in 'users' table (migration for existing database files)
    cursor.execute("PRAGMA table_info(users);")
    columns = [row['name'] for row in cursor.fetchall()]
    if 'is_admin' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;")
    if 'theme' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'neo-brutalist';")
    if 'google_id' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN google_id TEXT;")
    if 'email' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT;")
        
    # Check if 'type' column exists in 'projects' table (migration for existing database files)
    cursor.execute("PRAGMA table_info(projects);")
    proj_cols = [row['name'] for row in cursor.fetchall()]
    if 'type' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'alignment';")
    
    conn.commit()
    conn.close()

# --- User Functions ---

def create_user(username, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password)
    try:
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        is_admin = 1 if user_count == 0 else 0
        
        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
            (username, password_hash, is_admin)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def verify_user(username, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user and check_password_hash(user['password_hash'], password):
        return dict(user)
    return None

def get_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def get_user_by_google_id(google_id):
    if not google_id:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE google_id = ?', (google_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def get_user_by_email(email):
    if not email:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def link_google_id(user_id, google_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET google_id = ? WHERE id = ?', (google_id, user_id))
    conn.commit()
    conn.close()

def create_google_user(username, email, google_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        is_admin = 1 if user_count == 0 else 0
        
        # Unique username check / adjustment
        base_username = username or (email.split('@')[0] if email else 'user')
        final_username = base_username
        counter = 1
        while True:
            cursor.execute('SELECT id FROM users WHERE username = ?', (final_username,))
            if not cursor.fetchone():
                break
            final_username = f"{base_username}_{counter}"
            counter += 1

        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin, google_id, email) VALUES (?, ?, ?, ?, ?)',
            (final_username, '', is_admin, google_id, email)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def update_user_password(user_id, new_password):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(new_password)
    cursor.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        (password_hash, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def update_user_theme(user_id, theme):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE users SET theme = ? WHERE id = ?',
        (theme, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

# --- Project Functions ---

def create_project(name, description, project_type, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO projects (name, description, type, user_id) VALUES (?, ?, ?, ?)',
        (name, description, project_type, user_id)
    )
    conn.commit()
    project_id = cursor.lastrowid
    conn.close()
    return project_id

def initialize_project_channels(project_id, project_type):
    """Initializes default channels for a project based on its project_type."""
    if not project_type or project_type == 'empty':
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    if project_type == 'audio_transcript':
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
            (project_id, 1, "Audio", "audio", 0)
        )
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
            (project_id, 2, "Transcripción", "transcript", 1)
        )
    elif project_type == 'audio_transcript_translation':
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
            (project_id, 1, "Audio", "audio", 0)
        )
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
            (project_id, 2, "Transcripción", "transcript", 1)
        )
        cursor.execute(
            "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
            (project_id, 3, "Traducción", "translation", 2)
        )

    conn.commit()
    conn.close()


def list_projects(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.*, 'owner' as user_role 
        FROM projects p 
        WHERE p.user_id = ?
        UNION
        SELECT p.*, pc.role as user_role 
        FROM projects p 
        JOIN project_collaborators pc ON p.id = pc.project_id 
        WHERE pc.user_id = ?
        ORDER BY created_at DESC
    ''', (user_id, user_id))
    projects = cursor.fetchall()
    conn.close()
    return [dict(p) for p in projects]

def get_project(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project_row = cursor.fetchone()
    if not project_row:
        conn.close()
        return None
        
    project = dict(project_row)
    if project['user_id'] == user_id:
        project['user_role'] = 'owner'
        conn.close()
        return project
        
    cursor.execute('SELECT role FROM project_collaborators WHERE project_id = ? AND user_id = ?', (project_id, user_id))
    collab = cursor.fetchone()
    conn.close()
    if collab:
        project['user_role'] = collab['role']
        return project
        
    return None

def delete_project(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', (project_id, user_id))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0

# --- Audio Item Functions ---

def create_audio_item(project_id, audio_path, text_path, state_json="{}"):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO audio_items (project_id, audio_path, text_path, state_json) VALUES (?, ?, ?, ?)',
        (project_id, audio_path, text_path, state_json)
    )
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return item_id

def list_audio_items(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM audio_items WHERE project_id = ? ORDER BY created_at DESC', (project_id,))
    items = cursor.fetchall()
    conn.close()
    return [dict(i) for i in items]

def get_audio_item(item_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM audio_items WHERE id = ?', (item_id,))
    item = cursor.fetchone()
    conn.close()
    if item:
        return dict(item)
    return None

def update_audio_item_state(item_id, state_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE audio_items SET state_json = ? WHERE id = ?',
        (state_json, item_id)
    )
    conn.commit()
    conn.close()

def delete_audio_item(item_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM audio_items WHERE id = ?', (item_id,))
    conn.commit()
    conn.close()

# --- Admin CRUD Functions ---

def list_all_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, is_admin, created_at FROM users ORDER BY username ASC')
    users = cursor.fetchall()
    conn.close()
    return [dict(u) for u in users]

def update_user_admin(user_id, username, is_admin):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE users SET username = ?, is_admin = ? WHERE id = ?',
        (username, is_admin, user_id)
    )
    conn.commit()
    conn.close()

def delete_user_admin(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()

def list_all_projects_admin():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.*, u.username as owner_name 
        FROM projects p 
        LEFT JOIN users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC
    ''')
    projects = cursor.fetchall()
    conn.close()
    return [dict(p) for p in projects]

def update_project_admin(project_id, name, description, project_type, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE projects SET name = ?, description = ?, type = ?, user_id = ? WHERE id = ?',
        (name, description, project_type, user_id, project_id)
    )
    conn.commit()
    conn.close()

def delete_project_admin(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    conn.close()

def list_all_audio_items_admin():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT a.*, p.name as project_name 
        FROM audio_items a 
        LEFT JOIN projects p ON a.project_id = p.id 
        ORDER BY a.created_at DESC
    ''')
    items = cursor.fetchall()
    conn.close()
    return [dict(i) for i in items]

def update_audio_item_admin(item_id, project_id, audio_path, text_path, state_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE audio_items SET project_id = ?, audio_path = ?, text_path = ?, state_json = ? WHERE id = ?',
        (project_id, audio_path, text_path, state_json, item_id)
    )
    conn.commit()
    conn.close()

def get_project_admin(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    conn.close()
    if project:
        return dict(project)
    return None

def create_user_admin(username, password, is_admin):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password)
    try:
        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
            (username, password_hash, is_admin)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

# --- Collaborators Functions ---

def list_collaborators(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id as user_id, u.username, 'owner' as role 
        FROM projects p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
    ''', (project_id,))
    owner = cursor.fetchone()
    
    cursor.execute('''
        SELECT u.id as user_id, u.username, pc.role 
        FROM project_collaborators pc 
        JOIN users u ON pc.user_id = u.id 
        WHERE pc.project_id = ?
    ''', (project_id,))
    collabs = cursor.fetchall()
    conn.close()
    
    result = []
    if owner:
        result.append(dict(owner))
    result.extend([dict(c) for c in collabs])
    return result

def add_collaborator(project_id, username, role):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return {'success': False, 'error': 'user_not_found'}
        
    user_id = user['id']
    cursor.execute('SELECT user_id FROM projects WHERE id = ?', (project_id,))
    proj = cursor.fetchone()
    if proj and proj['user_id'] == user_id:
        conn.close()
        return {'success': False, 'error': 'is_owner'}
        
    try:
        cursor.execute(
            'INSERT INTO project_collaborators (project_id, user_id, role) VALUES (?, ?, ?)',
            (project_id, user_id, role)
        )
        conn.commit()
        conn.close()
        return {'success': True}
    except sqlite3.IntegrityError:
        conn.close()
        return {'success': False, 'error': 'already_collaborator'}

def update_collaborator_role(project_id, user_id, role):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE project_collaborators SET role = ? WHERE project_id = ? AND user_id = ?',
        (role, project_id, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def delete_collaborator(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?',
        (project_id, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def search_users_for_autocomplete(query, exclude_user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT username FROM users WHERE username LIKE ? AND id != ? LIMIT 10',
        ('%' + query + '%', exclude_user_id)
    )
    rows = cursor.fetchall()
    conn.close()
    return [row['username'] for row in rows]

# --- Module V2 Relational CRUD & Utilities ---

def parse_time_string(val):
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip()
    parts = val_str.split(':')
    try:
        if len(parts) == 3:
            h, m, s = map(float, parts)
            return h * 3600 + m * 60 + s
        elif len(parts) == 2:
            m, s = map(float, parts)
            return m * 60 + s
        else:
            return float(val_str)
    except ValueError:
        return 0.0

def format_seconds_to_time_str(seconds):
    if seconds is None:
        return "0:00:00"
    secs = float(seconds)
    hours = int(secs // 3600)
    minutes = int((secs % 3600) // 60)
    rem_secs = secs % 60
    if rem_secs.is_integer():
        return f"{hours}:{minutes:02d}:{int(rem_secs):02d}"
    else:
        return f"{hours}:{minutes:02d}:{rem_secs:05.2f}"

def import_v2_project_from_json(project_id, json_data):
    """Imports a project JSON payload (matching proj_desc.txt) into relational V2 tables."""
    if isinstance(json_data, str):
        import json
        json_data = json.loads(json_data)

    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Clear existing V2 data for this project
        cursor.execute("DELETE FROM v2_matches WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM v2_channels WHERE project_id = ?", (project_id,))

        channel_map = {}
        media_map = {}
        segment_map = {}

        for ch_idx, ch in enumerate(json_data.get("channels", [])):
            json_ch_id = ch.get("channel_id")
            cursor.execute(
                "INSERT INTO v2_channels (project_id, json_channel_id, name, type, channel_order) VALUES (?, ?, ?, ?, ?)",
                (project_id, json_ch_id, ch["name"], ch["type"], ch_idx)
            )
            db_ch_id = cursor.lastrowid
            channel_map[json_ch_id] = db_ch_id

            for med in ch.get("media", []):
                json_med_id = med.get("media_id")
                key_med = (json_ch_id, json_med_id)
                cursor.execute(
                    "INSERT INTO v2_media (channel_id, json_media_id, filename, media_type) VALUES (?, ?, ?, ?)",
                    (db_ch_id, json_med_id, med.get("filename", ""), med.get("type", ""))
                )
                db_med_id = cursor.lastrowid
                media_map[key_med] = db_med_id

                for seg_idx, seg in enumerate(med.get("segments", [])):
                    json_seg_id = seg.get("segment_id")
                    start_sec = parse_time_string(seg.get("start")) if "start" in seg else None
                    end_sec = parse_time_string(seg.get("end")) if "end" in seg else None
                    text_val = seg.get("text")

                    cursor.execute(
                        "INSERT INTO v2_segments (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (db_ch_id, db_med_id, json_seg_id, start_sec, end_sec, text_val, seg_idx)
                    )
                    db_seg_id = cursor.lastrowid
                    segment_map[json_seg_id] = db_seg_id

        for match_group in json_data.get("matches", []):
            cursor.execute("INSERT INTO v2_matches (project_id) VALUES (?)", (project_id,))
            db_match_id = cursor.lastrowid

            for item in match_group:
                json_ch_id = item["channel"]
                json_med_id = item["media"]
                json_seg_id = item["segment"]

                ch_id = channel_map.get(json_ch_id)
                med_id = media_map.get((json_ch_id, json_med_id))
                seg_id = segment_map.get(json_seg_id)

                if ch_id and med_id and seg_id:
                    cursor.execute(
                        "INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id) VALUES (?, ?, ?, ?)",
                        (db_match_id, seg_id, ch_id, med_id)
                    )

        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def export_v2_project_to_json(project_id):
    """Exports relational V2 project tables back into a proj_desc.txt formatted dict."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM v2_channels WHERE project_id = ? ORDER BY channel_order ASC", (project_id,))
    channels = [dict(r) for r in cursor.fetchall()]

    exported_channels = []
    for ch in channels:
        ch_dict = {
            "type": ch["type"],
            "name": ch["name"],
            "channel_id": ch["json_channel_id"] or ch["id"],
            "media": []
        }

        cursor.execute("SELECT * FROM v2_media WHERE channel_id = ?", (ch["id"],))
        media_list = [dict(m) for m in cursor.fetchall()]

        for med in media_list:
            med_dict = {
                "filename": med["filename"],
                "media_id": med["json_media_id"] or med["id"],
                "segments": []
            }
            if med["media_type"]:
                med_dict["type"] = med["media_type"]

            cursor.execute("SELECT * FROM v2_segments WHERE media_id = ? ORDER BY segment_order ASC", (med["id"],))
            segments = [dict(s) for s in cursor.fetchall()]

            for seg in segments:
                seg_dict = {
                    "segment_id": seg["json_segment_id"] or seg["id"]
                }
                if seg["start_time"] is not None and seg["end_time"] is not None:
                    seg_dict["start"] = format_seconds_to_time_str(seg["start_time"])
                    seg_dict["end"] = format_seconds_to_time_str(seg["end_time"])
                if seg["text_content"] is not None:
                    seg_dict["text"] = seg["text_content"]

                med_dict["segments"].append(seg_dict)

            ch_dict["media"].append(med_dict)
        exported_channels.append(ch_dict)

    cursor.execute("SELECT * FROM v2_matches WHERE project_id = ?", (project_id,))
    matches = [dict(m) for m in cursor.fetchall()]

    exported_matches = []
    for m in matches:
        cursor.execute("""
            SELECT ms.*, c.json_channel_id, c.id as ch_db_id, med.json_media_id, med.id as med_db_id, seg.json_segment_id, seg.id as seg_db_id
            FROM v2_match_segments ms
            JOIN v2_channels c ON ms.channel_id = c.id
            JOIN v2_media med ON ms.media_id = med.id
            JOIN v2_segments seg ON ms.segment_id = seg.id
            WHERE ms.match_id = ?
        """, (m["id"],))
        items = [dict(r) for r in cursor.fetchall()]

        match_group = []
        for item in items:
            match_group.append({
                "channel": item["json_channel_id"] or item["ch_db_id"],
                "media": item["json_media_id"] or item["med_db_id"],
                "segment": item["json_segment_id"] or item["seg_db_id"]
            })
        exported_matches.append(match_group)

    conn.close()

    return {
        "project": {
            "channels": exported_channels,
            "matches": exported_matches
        }
    }

def get_v2_project_full(project_id):
    """Returns structured V2 project data with all channels, media, segments, and match mappings."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    project_row = cursor.fetchone()
    if not project_row:
        conn.close()
        return None

    project = dict(project_row)

    cursor.execute("SELECT * FROM v2_channels WHERE project_id = ? ORDER BY channel_order ASC", (project_id,))
    channels = [dict(r) for r in cursor.fetchall()]

    for ch in channels:
        cursor.execute("SELECT * FROM v2_media WHERE channel_id = ?", (ch["id"],))
        media_list = [dict(m) for m in cursor.fetchall()]
        for med in media_list:
            cursor.execute("SELECT * FROM v2_segments WHERE media_id = ? ORDER BY segment_order ASC", (med["id"],))
            med["segments"] = [dict(s) for s in cursor.fetchall()]
        ch["media"] = media_list

    cursor.execute("SELECT * FROM v2_matches WHERE project_id = ?", (project_id,))
    matches = [dict(m) for m in cursor.fetchall()]

    for m in matches:
        cursor.execute("""
            SELECT ms.*, c.name as channel_name, c.type as channel_type, s.start_time, s.end_time, s.text_content
            FROM v2_match_segments ms
            JOIN v2_channels c ON ms.channel_id = c.id
            JOIN v2_segments s ON ms.segment_id = s.id
            WHERE ms.match_id = ?
        """, (m["id"],))
        m["items"] = [dict(r) for r in cursor.fetchall()]

    conn.close()

    project["channels"] = channels
    project["matches"] = matches
    return project

def create_v2_match(project_id, segment_ids):
    """Creates a new match linking multiple segment_ids together."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO v2_matches (project_id) VALUES (?)", (project_id,))
        match_id = cursor.lastrowid

        for seg_id in segment_ids:
            cursor.execute("SELECT channel_id, media_id FROM v2_segments WHERE id = ?", (seg_id,))
            seg = cursor.fetchone()
            if seg:
                cursor.execute(
                    "INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id) VALUES (?, ?, ?, ?)",
                    (match_id, seg_id, seg["channel_id"], seg["media_id"])
                )

        conn.commit()
        return match_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def delete_v2_match(match_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM v2_matches WHERE id = ?", (match_id,))
    conn.commit()
    conn.close()

def update_v2_segment_bounds(segment_id, start_time, end_time):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE v2_segments SET start_time = ?, end_time = ? WHERE id = ?",
        (start_time, end_time, segment_id)
    )
    conn.commit()
    conn.close()

def update_v2_segment_text(segment_id, text_content):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE v2_segments SET text_content = ? WHERE id = ?",
        (text_content, segment_id)
    )
    conn.commit()
    conn.close()

def list_v2_user_projects(user_id):
    """Returns separate lists for owned V2 projects and shared V2 projects."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT p.*, 'owner' as user_role 
        FROM projects p 
        WHERE p.user_id = ? AND p.type = 'multichannel_v2'
        ORDER BY created_at DESC
    ''', (user_id,))
    owned = [dict(p) for p in cursor.fetchall()]
    
    cursor.execute('''
        SELECT p.*, pc.role as user_role, u.username as owner_name
        FROM projects p 
        JOIN project_collaborators pc ON p.id = pc.project_id 
        JOIN users u ON p.user_id = u.id
        WHERE pc.user_id = ? AND p.type = 'multichannel_v2'
        ORDER BY created_at DESC
    ''', (user_id,))
    shared = [dict(p) for p in cursor.fetchall()]
    
    conn.close()
    return {
        'owned': owned,
        'shared': shared
    }

def update_v2_channel(channel_id, name, channel_type):
    """Updates a channel's name and type."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE v2_channels SET name = ?, type = ? WHERE id = ?",
        (name, channel_type, channel_id)
    )
    conn.commit()
    conn.close()

def add_v2_channel(project_id, name, channel_type):
    """Adds a new channel to a project."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(channel_order) FROM v2_channels WHERE project_id = ?", (project_id,))
    row = cursor.fetchone()
    max_order = row[0] if row and row[0] is not None else -1
    next_order = max_order + 1
    cursor.execute(
        "INSERT INTO v2_channels (project_id, name, type, channel_order) VALUES (?, ?, ?, ?)",
        (project_id, name, channel_type, next_order)
    )
    conn.commit()
    channel_id = cursor.lastrowid
    conn.close()
    return channel_id

def delete_v2_channel(channel_id):
    """Deletes a channel by id."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM v2_channels WHERE id = ?", (channel_id,))
    conn.commit()
    conn.close()
    return True

def add_v2_media(channel_id, filename, media_type="audio"):
    """Adds a new media file / slot record to a channel."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO v2_media (channel_id, filename, media_type) VALUES (?, ?, ?)",
        (channel_id, filename, media_type)
    )
    conn.commit()
    media_id = cursor.lastrowid
    conn.close()
    return media_id

def save_v2_media_segments(media_id, channel_id, segments):
    """Saves segment records for a v2_media item, updating existing segments in place to preserve match links."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Always resolve the media's true channel_id from v2_media to prevent cross-channel contamination
    cursor.execute("SELECT channel_id FROM v2_media WHERE id = ?", (media_id,))
    media_row = cursor.fetchone()
    if media_row and media_row['channel_id']:
        channel_id = media_row['channel_id']

    # Retrieve existing segments for this media
    cursor.execute("SELECT id FROM v2_segments WHERE media_id = ?", (media_id,))
    existing_db_ids = set(r['id'] for r in cursor.fetchall())
    
    incoming_ids = set()

    for idx, seg in enumerate(segments):
        start_time = float(seg['start']) if seg.get('start') is not None else None
        end_time = float(seg['end']) if seg.get('end') is not None else None
        text_val = seg.get('text', '')
        json_seg_id = seg.get('json_segment_id', idx + 1)
        seg_id = seg.get('id')

        if seg_id and int(seg_id) in existing_db_ids:
            incoming_ids.add(int(seg_id))
            cursor.execute(
                """UPDATE v2_segments 
                   SET channel_id = ?, json_segment_id = ?, start_time = ?, end_time = ?, text_content = ?, segment_order = ?
                   WHERE id = ? AND media_id = ?""",
                (channel_id, json_seg_id, start_time, end_time, text_val, idx, int(seg_id), media_id)
            )
        else:
            cursor.execute(
                """INSERT INTO v2_segments 
                   (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (channel_id, media_id, json_seg_id, start_time, end_time, text_val, idx)
            )

    # Delete any segments that were removed by the user
    to_delete = existing_db_ids - incoming_ids
    for del_id in to_delete:
        cursor.execute("DELETE FROM v2_segments WHERE id = ? AND media_id = ?", (del_id, media_id))

    # Clean up empty match groups (matches with less than 2 valid segment links)
    cursor.execute("""
        DELETE FROM v2_matches 
        WHERE id IN (
            SELECT m.id FROM v2_matches m
            LEFT JOIN v2_match_segments ms ON m.id = ms.match_id
            GROUP BY m.id
            HAVING COUNT(ms.id) < 2
        )
    """)

    cursor.execute("UPDATE v2_media SET status = 'segmented' WHERE id = ?", (media_id,))
    conn.commit()
    conn.close()
    return True

def import_tabular_csv_media(project_id, filename, csv_content, column_mappings, delimiter=','):
    """
    Imports tabular CSV data:
    1. column_mappings: dict of { str(col_index): int(channel_id) }
    2. Parses CSV content into rows.
    3. Row 0 is column headers.
    4. Rows 1..N: creates media item & text segments for each assigned channel.
    5. Automatically creates v2_matches linking row i across all assigned channels.
    """
    import csv
    from io import StringIO

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        f = StringIO(csv_content)
        reader = csv.reader(f, delimiter=delimiter)
        all_rows = [row for row in reader if any(cell.strip() for cell in row)]

        if len(all_rows) < 1:
            conn.close()
            return {'error': 'Empty CSV file'}

        header = all_rows[0]
        data_rows = all_rows[1:]

        chan_col_map = {}
        for col_idx_str, ch_id_val in column_mappings.items():
            if ch_id_val:
                chan_col_map[int(ch_id_val)] = int(col_idx_str)

        if not chan_col_map:
            conn.close()
            return {'error': 'No channels mapped'}

        chan_media_map = {}
        for ch_id in chan_col_map.keys():
            cursor.execute(
                "INSERT INTO v2_media (channel_id, filename, media_type, status) VALUES (?, ?, ?, ?)",
                (ch_id, filename, 'csv', 'segmented')
            )
            chan_media_map[ch_id] = cursor.lastrowid

        created_matches_count = 0
        total_segments_count = 0

        for row_idx, row in enumerate(data_rows):
            row_seg_ids = []
            for ch_id, col_idx in chan_col_map.items():
                cell_value = row[col_idx].strip() if col_idx < len(row) else ''
                media_id = chan_media_map[ch_id]
                json_seg_id = row_idx + 1

                cursor.execute(
                    """INSERT INTO v2_segments 
                       (channel_id, media_id, json_segment_id, start_time, end_time, text_content, segment_order) 
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (ch_id, media_id, json_seg_id, None, None, cell_value, row_idx)
                )
                seg_id = cursor.lastrowid
                row_seg_ids.append((ch_id, media_id, seg_id))
                total_segments_count += 1

            if len(row_seg_ids) >= 2:
                cursor.execute("INSERT INTO v2_matches (project_id) VALUES (?)", (project_id,))
                match_id = cursor.lastrowid
                for ch_id, media_id, seg_id in row_seg_ids:
                    cursor.execute(
                        "INSERT INTO v2_match_segments (match_id, segment_id, channel_id, media_id) VALUES (?, ?, ?, ?)",
                        (match_id, seg_id, ch_id, media_id)
                    )
                created_matches_count += 1

        conn.commit()
        return {
            'channels_count': len(chan_media_map),
            'segments_count': total_segments_count,
            'matches_count': created_matches_count
        }

    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()





