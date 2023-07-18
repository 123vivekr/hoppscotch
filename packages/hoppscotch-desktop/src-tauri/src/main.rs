// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{async_runtime::block_on, Manager};

use actix_cors::Cors;
use actix_web::{
    middleware, options, post, rt, web, App, HttpRequest, HttpResponse, HttpServer, Responder,
};
use serde::Deserialize;

use once_cell::sync::Lazy;
use std::{sync::Mutex, thread};

static TASK_SHUTDOWN: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

#[derive(Debug, Deserialize)]
struct RequestData {
    accessToken: String,
    refreshToken: String,
}

#[post("/")]
async fn handle_post(request: web::Json<RequestData>) -> HttpResponse {
    println!("{}", request.accessToken);
    HttpResponse::Ok()
        .append_header((
            "Set-Cookie",
            format!("access_token={}", request.accessToken),
        ))
        .append_header((
            "Set-Cookie",
            format!("refresh_token={}", request.refreshToken),
        ))
        .body("Cookies set")
}

#[tauri::command]
async fn stop_server() {
    *TASK_SHUTDOWN.lock().unwrap() = true;
}

#[tauri::command]
async fn start_server() {
    let server = HttpServer::new(|| {
        let cors = Cors::permissive();

        App::new().wrap(cors).service(handle_post)
    })
    .bind("127.0.0.1:3001")
    .unwrap();

    // TODO: Error handling

    let handle = tokio::spawn(server.run());

    thread::spawn(move || {
        loop {
            if *TASK_SHUTDOWN.lock().unwrap() {
                handle.abort();
                return;
            }
        }
    });
}

fn main() {
    tauri_plugin_deep_link::prepare("io.hoppscotch.desktop");

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            tauri_plugin_deep_link::register("hoppscotch", move |request| {
                handle.emit_all("scheme-request-received", request).unwrap();
            })
            .unwrap();
            Ok(())
        })
        // .invoke_handler(tauri::generate_handler![start_server(rx, run_server.clone()), stop_server(run_server)])
        .invoke_handler(tauri::generate_handler![start_server, stop_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
