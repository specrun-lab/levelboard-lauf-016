package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	address := os.Getenv("LEVELBOARD_ADDR")
	if address == "" {
		address = "127.0.0.1:8081"
	}
	databasePath := os.Getenv("LEVELBOARD_DB")
	if databasePath == "" {
		databasePath = ".run/levelboard.db"
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		log.Fatalf("Datenbank konnte nicht geöffnet werden: %v", err)
	}
	defer store.Close()

	server := &http.Server{
		Addr:              address,
		Handler:           logRequests(NewServer(store)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Herunterfahren: %v", err)
		}
	}()

	log.Printf("Backend lauscht auf %s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Serverfehler: %v", err)
	}
}
