import os
import shutil
from datetime import datetime
from werkzeug.utils import secure_filename

def format_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

def get_user_repo_base(upload_folder, user_id):
    repo_base = os.path.abspath(os.path.join(upload_folder, 'repositories', f"user_{user_id}"))
    os.makedirs(repo_base, exist_ok=True)
    return repo_base

def safe_join_user_repo(upload_folder, user_id, relative_path=""):
    repo_base = get_user_repo_base(upload_folder, user_id)
    if not relative_path:
        return repo_base, ""
    
    clean_rel = str(relative_path).lstrip('/\\')
    target_path = os.path.abspath(os.path.join(repo_base, clean_rel))
    
    if not (target_path == repo_base or target_path.startswith(repo_base + os.sep)):
        raise ValueError("Invalid path access outside repository boundary.")
        
    rel_from_base = os.path.relpath(target_path, repo_base)
    if rel_from_base == ".":
        rel_from_base = ""
    return target_path, rel_from_base.replace('\\', '/')

def get_repo_summary(upload_folder, user_id):
    repo_base = get_user_repo_base(upload_folder, user_id)
    file_count = 0
    folder_count = 0
    total_size = 0
    top_items = []
    
    for root, dirs, files in os.walk(repo_base):
        if root == repo_base:
            folder_count += len(dirs)
        else:
            folder_count += len(dirs)
        for f in files:
            file_count += 1
            file_p = os.path.join(root, f)
            try:
                total_size += os.path.getsize(file_p)
            except OSError:
                pass
                
    # List top level items for quick preview
    try:
        entries = sorted(os.listdir(repo_base))
        for entry in entries[:6]: # top 6 items
            full_p = os.path.join(repo_base, entry)
            is_dir = os.path.isdir(full_p)
            size_b = 0 if is_dir else os.path.getsize(full_p)
            top_items.append({
                'name': entry,
                'is_dir': is_dir,
                'size': size_b,
                'formatted_size': format_size(size_b) if not is_dir else '',
                'rel_path': entry
            })
    except Exception:
        pass
        
    return {
        'file_count': file_count,
        'folder_count': folder_count,
        'total_size': total_size,
        'formatted_size': format_size(total_size),
        'top_items': top_items
    }

def list_repo_dir(upload_folder, user_id, relative_path=""):
    target_path, clean_rel = safe_join_user_repo(upload_folder, user_id, relative_path)
    
    if not os.path.exists(target_path):
        os.makedirs(target_path, exist_ok=True)
        
    if not os.path.isdir(target_path):
        raise ValueError("Requested path is not a directory.")
        
    items = []
    for entry in os.listdir(target_path):
        full_p = os.path.join(target_path, entry)
        is_dir = os.path.isdir(full_p)
        entry_rel = os.path.join(clean_rel, entry).replace('\\', '/') if clean_rel else entry
        
        stat = os.stat(full_p)
        size_b = 0 if is_dir else stat.st_size
        mtime = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M')
        
        ext = ""
        if not is_dir and '.' in entry:
            ext = entry.rsplit('.', 1)[1].lower()
            
        items.append({
            'name': entry,
            'rel_path': entry_rel,
            'is_dir': is_dir,
            'size': size_b,
            'formatted_size': format_size(size_b) if not is_dir else '',
            'mtime': mtime,
            'ext': ext
        })
        
    # Sort folders first, then files alphabetically
    items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    
    # Breadcrumbs
    breadcrumbs = [{'name': 'Root', 'path': ''}]
    if clean_rel:
        parts = clean_rel.split('/')
        accum = ""
        for p in parts:
            if not p:
                continue
            accum = f"{accum}/{p}" if accum else p
            breadcrumbs.append({'name': p, 'path': accum})
            
    parent_path = None
    if clean_rel:
        parent_parts = clean_rel.split('/')[:-1]
        parent_path = '/'.join(parent_parts)
        
    return {
        'current_path': clean_rel,
        'breadcrumbs': breadcrumbs,
        'parent_path': parent_path,
        'items': items
    }

def create_repo_folder(upload_folder, user_id, relative_path, folder_name):
    if not folder_name or '/' in folder_name or '\\' in folder_name:
        raise ValueError("Invalid folder name.")
        
    sanitized_name = secure_filename(folder_name)
    if not sanitized_name:
        sanitized_name = folder_name.replace(' ', '_').strip(' .')
        if not sanitized_name:
            raise ValueError("Invalid folder name.")
            
    target_dir, clean_rel = safe_join_user_repo(upload_folder, user_id, relative_path)
    new_folder_path = os.path.join(target_dir, sanitized_name)
    
    # Verify new folder path is inside repo
    safe_join_user_repo(upload_folder, user_id, os.path.join(clean_rel, sanitized_name))
    
    if os.path.exists(new_folder_path):
        raise ValueError("Folder already exists.")
        
    os.makedirs(new_folder_path, exist_ok=True)
    return os.path.join(clean_rel, sanitized_name).replace('\\', '/')

def upload_repo_files(upload_folder, user_id, relative_path, files):
    target_dir, clean_rel = safe_join_user_repo(upload_folder, user_id, relative_path)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir, exist_ok=True)
        
    saved_files = []
    for file in files:
        if not file or not file.filename:
            continue
        filename = secure_filename(file.filename)
        if not filename:
            filename = file.filename.replace('/', '_').replace('\\', '_')
        save_path = os.path.join(target_dir, filename)
        file.save(save_path)
        saved_files.append(filename)
    return saved_files

def delete_repo_item(upload_folder, user_id, relative_path):
    target_path, clean_rel = safe_join_user_repo(upload_folder, user_id, relative_path)
    if not clean_rel:
        raise ValueError("Cannot delete root directory.")
    if not os.path.exists(target_path):
        raise ValueError("Item does not exist.")
        
    if os.path.isdir(target_path):
        shutil.rmtree(target_path)
    else:
        os.remove(target_path)
    return True

def rename_repo_item(upload_folder, user_id, relative_path, new_name):
    if not new_name or '/' in new_name or '\\' in new_name:
        raise ValueError("Invalid target name.")
    target_path, clean_rel = safe_join_user_repo(upload_folder, user_id, relative_path)
    if not clean_rel:
        raise ValueError("Cannot rename root directory.")
    if not os.path.exists(target_path):
        raise ValueError("Item does not exist.")
        
    sanitized_name = secure_filename(new_name)
    if not sanitized_name:
        sanitized_name = new_name.replace(' ', '_').strip(' .')
    if not sanitized_name:
        raise ValueError("Invalid target name.")
        
    parent_dir = os.path.dirname(target_path)
    new_path = os.path.join(parent_dir, sanitized_name)
    
    if os.path.exists(new_path):
        raise ValueError("An item with that name already exists.")
        
    os.rename(target_path, new_path)
    return True
