import os
from PIL import Image

def make_background_transparent(input_path, output_path):
    print(f"Loading {input_path}...")
    img = Image.open(input_path).convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    # threshold for black background detection (0-255 range)
    threshold = 30
    
    for item in datas:
        # item is (r, g, b, a)
        # Check if the pixel is near-black
        if item[0] < threshold and item[1] < threshold and item[2] < threshold:
            # Set alpha channel to 0 (fully transparent)
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    
    # Save as transparent PNG
    img.save(output_path, "PNG")
    print(f"Saved transparent image to {output_path}")

if __name__ == "__main__":
    base_dir = r"d:\NextupAI\Project-NextUp"
    jpg_path = os.path.join(base_dir, "frontend", "public", "logo.jpg")
    png_path = os.path.join(base_dir, "frontend", "public", "logo.png")
    app_icon_png = os.path.join(base_dir, "frontend", "app", "icon.png")
    app_icon_jpg = os.path.join(base_dir, "frontend", "app", "icon.jpg")
    app_favicon = os.path.join(base_dir, "frontend", "app", "favicon.ico")
    
    if os.path.exists(jpg_path):
        # 1. Generate transparent png in public folder
        make_background_transparent(jpg_path, png_path)
        
        # 2. Save transparent png to app icon/favicon paths
        make_background_transparent(jpg_path, app_icon_png)
        
        # Since favicon.ico is standard, let's save the transparent PNG directly as favicon.ico
        # PIL can save PNG data directly as ICO
        img_png = Image.open(app_icon_png)
        img_png.save(app_favicon, format="ICO", sizes=[(32, 32), (48, 48), (64, 64)])
        print(f"Saved transparent favicon.ico to {app_favicon}")
        
        # Remove the icon.jpg since icon.png takes precedence and we want to avoid any cached jpg fallback
        if os.path.exists(app_icon_jpg):
            os.remove(app_icon_jpg)
            print("Removed old app/icon.jpg to prevent collision")
    else:
        print(f"Error: {jpg_path} not found.")
